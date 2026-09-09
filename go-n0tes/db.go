package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type Section struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
}

type Note struct {
	ID        string    `json:"id"`
	SectionID string    `json:"section_id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// In-memory store fallback if DATABASE_URL is not set
type MemoryStore struct {
	mu       sync.RWMutex
	sections []Section
	notes    []Note
}

var memStore = &MemoryStore{
	sections: []Section{
		{ID: "sec-general", Name: "General", SortOrder: 1, CreatedAt: time.Now()},
		{ID: "sec-todo", Name: "To-Do & Tasks", SortOrder: 2, CreatedAt: time.Now()},
		{ID: "sec-ideas", Name: "Ideas & Drafts", SortOrder: 3, CreatedAt: time.Now()},
	},
	notes: []Note{
		{
			ID:        "note-welcome",
			SectionID: "sec-general",
			Title:     "Welcome to Your Go Notepad",
			Content:   "Welcome to your electronic notepad built with Go and backed by NeonDB PostgreSQL!\n\n• Organize your notes under sections.\n• Highlight text and click '🔗 Add Link' (or press Ctrl+K) to attach hyperlinks.\n• Edits auto-save continuously and on page close.\n\nEnjoy writing in Go!",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
	},
}

func generateID(prefix string) string {
	b := make([]byte, 4)
	rand.Read(b)
	return fmt.Sprintf("%s-%s%d", prefix, hex.EncodeToString(b), time.Now().UnixNano()%100000)
}

func isNeonConfigured() bool {
	url := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	return url != ""
}

func getCleanDatabaseURL() string {
	raw := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	cleaned := strings.ReplaceAll(raw, "&channel_binding=require", "")
	cleaned = strings.ReplaceAll(cleaned, "?channel_binding=require&", "?")
	return strings.TrimSpace(cleaned)
}

// Neon Serverless HTTPS SQL Execution (Port 443 - Firewall Immune)
type NeonQueryResponse struct {
	Rows     []map[string]any `json:"rows"`
	RowCount int              `json:"rowCount"`
	Command  string           `json:"command"`
	Error    string           `json:"error,omitempty"`
	Message  string           `json:"message,omitempty"`
}

var (
	httpClient = &http.Client{Timeout: 12 * time.Second}
	initOnce   sync.Once
	initErr    error
)

func executeNeonSQL(query string, params []any) (*NeonQueryResponse, error) {
	if !isNeonConfigured() {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}

	cleanURL := getCleanDatabaseURL()
	parsed, err := url.Parse(cleanURL)
	if err != nil {
		return nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}

	host := parsed.Hostname()
	apiURL := fmt.Sprintf("https://%s/sql", host)

	if params == nil {
		params = []any{}
	}

	reqPayload := map[string]any{
		"query":  query,
		"params": params,
	}

	jsonBytes, err := json.Marshal(reqPayload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Neon-Connection-String", cleanURL)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("neon request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("neon HTTP %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result NeonQueryResponse
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to parse neon response: %w", err)
	}

	return &result, nil
}

func initDatabase() error {
	if !isNeonConfigured() {
		return nil
	}

	initOnce.Do(func() {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS sections (
				id TEXT PRIMARY KEY,
				name VARCHAR(100) NOT NULL,
				sort_order INT DEFAULT 0,
				created_at TIMESTAMPTZ DEFAULT NOW()
			);`,
			`CREATE TABLE IF NOT EXISTS notes (
				id TEXT PRIMARY KEY,
				section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
				title VARCHAR(255) NOT NULL DEFAULT 'Untitled Note',
				content TEXT DEFAULT '',
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW()
			);`,
			`CREATE INDEX IF NOT EXISTS idx_notes_section_id ON notes(section_id);`,
			`CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);`,
			`CREATE INDEX IF NOT EXISTS idx_sections_sort_order ON sections(sort_order ASC, created_at ASC);`,
		}

		for _, stmt := range statements {
			if _, err := executeNeonSQL(stmt, nil); err != nil {
				initErr = fmt.Errorf("failed executing schema: %w", err)
				return
			}
		}

		// Seed sections if empty
		res, err := executeNeonSQL("SELECT COUNT(*) as count FROM sections;", nil)
		if err == nil && len(res.Rows) > 0 {
			var count int64
			if c, ok := res.Rows[0]["count"].(float64); ok {
				count = int64(c)
			}
			if count == 0 {
				_, _ = executeNeonSQL("INSERT INTO sections (id, name, sort_order) VALUES ('sec-general', 'General', 1), ('sec-todo', 'To-Do & Tasks', 2), ('sec-ideas', 'Ideas & Drafts', 3);", nil)
				_, _ = executeNeonSQL("INSERT INTO notes (id, section_id, title, content) VALUES ('note-welcome', 'sec-general', 'Welcome to Your Go Notepad', 'Welcome to your electronic notepad built with Go and backed by NeonDB PostgreSQL!\n\n• Organize your notes under sections.\n• Highlight text and click 🔗 Add Link (or press Ctrl+K) to attach hyperlinks.\n• Edits auto-save continuously and on page close.\n\nEnjoy writing in Go!');", nil)
			}
		}

		log.Println("✓ Connected and initialized NeonDB PostgreSQL over HTTPS (Port 443)!")
	})

	return initErr
}

// Data Access Layer

func parseTime(val any) time.Time {
	if s, ok := val.(string); ok {
		t, err := time.Parse(time.RFC3339, s)
		if err == nil {
			return t
		}
		t2, err2 := time.Parse("2006-01-02 15:04:05.999999-07", s)
		if err2 == nil {
			return t2
		}
		t3, err3 := time.Parse("2006-01-02 15:04:05.999999+00", s)
		if err3 == nil {
			return t3
		}
	}
	return time.Now()
}

func GetSections() ([]Section, error) {
	if !isNeonConfigured() {
		memStore.mu.RLock()
		defer memStore.mu.RUnlock()
		res := make([]Section, len(memStore.sections))
		copy(res, memStore.sections)
		return res, nil
	}

	if err := initDatabase(); err != nil {
		return nil, err
	}

	res, err := executeNeonSQL("SELECT id, name, sort_order, created_at FROM sections ORDER BY sort_order ASC, created_at ASC;", nil)
	if err != nil {
		return nil, err
	}

	var sections []Section
	for _, row := range res.Rows {
		s := Section{
			ID:        fmt.Sprintf("%v", row["id"]),
			Name:      fmt.Sprintf("%v", row["name"]),
			CreatedAt: parseTime(row["created_at"]),
		}
		if so, ok := row["sort_order"].(float64); ok {
			s.SortOrder = int(so)
		}
		sections = append(sections, s)
	}
	if sections == nil {
		sections = []Section{}
	}
	return sections, nil
}

func CreateSection(name string) (*Section, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		trimmed = "Untitled Section"
	}
	id := generateID("sec")

	if !isNeonConfigured() {
		memStore.mu.Lock()
		defer memStore.mu.Unlock()
		s := Section{
			ID:        id,
			Name:      trimmed,
			SortOrder: len(memStore.sections) + 1,
			CreatedAt: time.Now(),
		}
		memStore.sections = append(memStore.sections, s)
		return &s, nil
	}

	if err := initDatabase(); err != nil {
		return nil, err
	}

	query := `
		INSERT INTO sections (id, name, sort_order)
		VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sections))
		RETURNING id, name, sort_order, created_at;
	`
	res, err := executeNeonSQL(query, []any{id, trimmed})
	if err != nil {
		return nil, err
	}
	if len(res.Rows) == 0 {
		return nil, fmt.Errorf("failed to create section")
	}

	row := res.Rows[0]
	s := &Section{
		ID:        fmt.Sprintf("%v", row["id"]),
		Name:      fmt.Sprintf("%v", row["name"]),
		CreatedAt: parseTime(row["created_at"]),
	}
	if so, ok := row["sort_order"].(float64); ok {
		s.SortOrder = int(so)
	}
	return s, nil
}

func UpdateSection(id, name string) (*Section, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		trimmed = "Untitled Section"
	}

	if !isNeonConfigured() {
		memStore.mu.Lock()
		defer memStore.mu.Unlock()
		for i := range memStore.sections {
			if memStore.sections[i].ID == id {
				memStore.sections[i].Name = trimmed
				return &memStore.sections[i], nil
			}
		}
		return nil, fmt.Errorf("section not found")
	}

	if err := initDatabase(); err != nil {
		return nil, err
	}

	query := "UPDATE sections SET name = $1 WHERE id = $2 RETURNING id, name, sort_order, created_at;"
	res, err := executeNeonSQL(query, []any{trimmed, id})
	if err != nil {
		return nil, err
	}
	if len(res.Rows) == 0 {
		return nil, fmt.Errorf("section not found")
	}

	row := res.Rows[0]
	s := &Section{
		ID:        fmt.Sprintf("%v", row["id"]),
		Name:      fmt.Sprintf("%v", row["name"]),
		CreatedAt: parseTime(row["created_at"]),
	}
	if so, ok := row["sort_order"].(float64); ok {
		s.SortOrder = int(so)
	}
	return s, nil
}

func DeleteSection(id string) error {
	if !isNeonConfigured() {
		memStore.mu.Lock()
		defer memStore.mu.Unlock()
		var newSecs []Section
		for _, s := range memStore.sections {
			if s.ID != id {
				newSecs = append(newSecs, s)
			}
		}
		memStore.sections = newSecs

		var newNotes []Note
		for _, n := range memStore.notes {
			if n.SectionID != id {
				newNotes = append(newNotes, n)
			}
		}
		memStore.notes = newNotes
		return nil
	}

	if err := initDatabase(); err != nil {
		return err
	}

	_, err := executeNeonSQL("DELETE FROM sections WHERE id = $1;", []any{id})
	return err
}

func GetNotes(sectionID string) ([]Note, error) {
	if !isNeonConfigured() {
		memStore.mu.RLock()
		defer memStore.mu.RUnlock()
		var res []Note
		for _, n := range memStore.notes {
			if n.SectionID == sectionID {
				res = append(res, n)
			}
		}
		if res == nil {
			res = []Note{}
		}
		return res, nil
	}

	if err := initDatabase(); err != nil {
		return nil, err
	}

	query := "SELECT id, section_id, title, content, created_at, updated_at FROM notes WHERE section_id = $1 ORDER BY updated_at DESC;"
	res, err := executeNeonSQL(query, []any{sectionID})
	if err != nil {
		return nil, err
	}

	var notes []Note
	for _, row := range res.Rows {
		n := Note{
			ID:        fmt.Sprintf("%v", row["id"]),
			SectionID: fmt.Sprintf("%v", row["section_id"]),
			Title:     fmt.Sprintf("%v", row["title"]),
			Content:   fmt.Sprintf("%v", row["content"]),
			CreatedAt: parseTime(row["created_at"]),
			UpdatedAt: parseTime(row["updated_at"]),
		}
		notes = append(notes, n)
	}
	if notes == nil {
		notes = []Note{}
	}
	return notes, nil
}

func CreateNote(sectionID, title, content, customID string) (*Note, error) {
	id := customID
	if strings.TrimSpace(id) == "" {
		id = generateID("note")
	}
	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" {
		trimmedTitle = "Untitled Note"
	}
	now := time.Now()

	if !isNeonConfigured() {
		memStore.mu.Lock()
		defer memStore.mu.Unlock()
		n := Note{
			ID:        id,
			SectionID: sectionID,
			Title:     trimmedTitle,
			Content:   content,
			CreatedAt: now,
			UpdatedAt: now,
		}
		memStore.notes = append([]Note{n}, memStore.notes...)
		return &n, nil
	}

	return UpsertNote(id, sectionID, trimmedTitle, content)
}

// UpsertNote atomically saves or updates the note in NeonDB
func UpsertNote(id, sectionID, title, content string) (*Note, error) {
	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" {
		trimmedTitle = "Untitled Note"
	}
	now := time.Now()

	if !isNeonConfigured() {
		memStore.mu.Lock()
		defer memStore.mu.Unlock()
		for i := range memStore.notes {
			if memStore.notes[i].ID == id {
				memStore.notes[i].Title = trimmedTitle
				memStore.notes[i].Content = content
				memStore.notes[i].UpdatedAt = now
				return &memStore.notes[i], nil
			}
		}
		secID := sectionID
		if secID == "" && len(memStore.sections) > 0 {
			secID = memStore.sections[0].ID
		}
		n := Note{
			ID:        id,
			SectionID: secID,
			Title:     trimmedTitle,
			Content:   content,
			CreatedAt: now,
			UpdatedAt: now,
		}
		memStore.notes = append([]Note{n}, memStore.notes...)
		return &n, nil
	}

	if err := initDatabase(); err != nil {
		return nil, err
	}

	secID := sectionID
	if secID == "" {
		secRes, err := executeNeonSQL("SELECT id FROM sections LIMIT 1;", nil)
		if err == nil && len(secRes.Rows) > 0 {
			secID = fmt.Sprintf("%v", secRes.Rows[0]["id"])
		}
		if secID == "" {
			secID = "sec-general"
		}
	}

	query := `
		INSERT INTO notes (id, section_id, title, content, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE
		SET 
			title = EXCLUDED.title,
			content = EXCLUDED.content,
			updated_at = NOW()
		RETURNING id, section_id, title, content, created_at, updated_at;
	`
	res, err := executeNeonSQL(query, []any{id, secID, trimmedTitle, content})
	if err != nil {
		return nil, fmt.Errorf("failed to upsert note in NeonDB: %w", err)
	}
	if len(res.Rows) == 0 {
		return nil, fmt.Errorf("no row returned from upsert")
	}

	row := res.Rows[0]
	n := &Note{
		ID:        fmt.Sprintf("%v", row["id"]),
		SectionID: fmt.Sprintf("%v", row["section_id"]),
		Title:     fmt.Sprintf("%v", row["title"]),
		Content:   fmt.Sprintf("%v", row["content"]),
		CreatedAt: parseTime(row["created_at"]),
		UpdatedAt: parseTime(row["updated_at"]),
	}
	return n, nil
}

func DeleteNote(id string) error {
	if !isNeonConfigured() {
		memStore.mu.Lock()
		defer memStore.mu.Unlock()
		var newNotes []Note
		for _, n := range memStore.notes {
			if n.ID != id {
				newNotes = append(newNotes, n)
			}
		}
		memStore.notes = newNotes
		return nil
	}

	if err := initDatabase(); err != nil {
		return err
	}

	_, err := executeNeonSQL("DELETE FROM notes WHERE id = $1;", []any{id})
	return err
}
