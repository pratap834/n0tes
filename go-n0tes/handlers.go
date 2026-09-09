package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]any{
		"isNeon":    isNeonConfigured(),
		"timestamp": time.Now().Format(time.RFC3339),
		"engine":    "Go",
	})
}

// Sections Handlers
func handleGetSections(w http.ResponseWriter, r *http.Request) {
	sections, err := GetSections()
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"sections": sections})
}

func handleCreateSection(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	trimmed := strings.TrimSpace(body.Name)
	if trimmed == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "section name is required"})
		return
	}

	section, err := CreateSection(trimmed)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]any{"section": section})
}

func handleUpdateSection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "id parameter is required"})
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	section, err := UpdateSection(id, body.Name)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"section": section})
}

func handleDeleteSection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "id parameter is required"})
		return
	}

	if err := DeleteSection(id); err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "id": id})
}

// Notes Handlers
func handleGetNotes(w http.ResponseWriter, r *http.Request) {
	sectionID := r.URL.Query().Get("sectionId")
	if sectionID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "sectionId query parameter is required"})
		return
	}

	notes, err := GetNotes(sectionID)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"notes": notes})
}

func handleCreateNote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID        string `json:"id"`
		SectionID string `json:"sectionId"`
		Title     string `json:"title"`
		Content   string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	if strings.TrimSpace(body.SectionID) == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "sectionId is required"})
		return
	}

	note, err := CreateNote(body.SectionID, body.Title, body.Content, body.ID)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]any{"note": note})
}

func handleUpdateNote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "id parameter is required"})
		return
	}

	var body struct {
		SectionID string `json:"sectionId"`
		Title     string `json:"title"`
		Content   string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	note, err := UpsertNote(id, body.SectionID, body.Title, body.Content)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"note": note})
}

func handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "id parameter is required"})
		return
	}

	if err := DeleteNote(id); err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "id": id})
}

// Beacon Unload Auto-Save Handler
func handleSaveBeacon(w http.ResponseWriter, r *http.Request) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var payload struct {
		ID        string `json:"id"`
		SectionID string `json:"sectionId"`
		Title     string `json:"title"`
		Content   string `json:"content"`
	}

	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	if payload.ID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "id is required"})
		return
	}

	note, err := UpsertNote(payload.ID, payload.SectionID, payload.Title, payload.Content)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "note": note})
}
