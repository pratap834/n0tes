package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

//go:embed static/*
var staticFS embed.FS

func main() {
	// 1. Load environment variables from .env if present
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if strings.TrimSpace(port) == "" {
		port = "8080"
	}

	// 2. Initialize database connection if DATABASE_URL is set
	if isNeonConfigured() {
		if err := initDatabase(); err != nil {
			log.Printf("⚠ Warning: Failed to connect to NeonDB on startup: %v. Running in fallback mode.\n", err)
		}
	} else {
		log.Println("📌 Notice: DATABASE_URL not set. Running in Local Memory / Demo Mode.")
	}

	// 3. Create HTTP router
	mux := http.NewServeMux()

	// API Routes (Go 1.22+ method-based route patterns)
	mux.HandleFunc("GET /api/status", handleStatus)
	mux.HandleFunc("GET /api/sections", handleGetSections)
	mux.HandleFunc("POST /api/sections", handleCreateSection)
	mux.HandleFunc("PATCH /api/sections/{id}", handleUpdateSection)
	mux.HandleFunc("DELETE /api/sections/{id}", handleDeleteSection)

	mux.HandleFunc("GET /api/notes", handleGetNotes)
	mux.HandleFunc("POST /api/notes", handleCreateNote)
	mux.HandleFunc("PATCH /api/notes/{id}", handleUpdateNote)
	mux.HandleFunc("DELETE /api/notes/{id}", handleDeleteNote)

	mux.HandleFunc("POST /api/notes/save-beacon", handleSaveBeacon)

	// Static Assets Server (Embedded)
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("Failed to create sub filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(subFS))
	mux.Handle("/", fileServer)

	// Logging banner
	dbStatus := "Offline / Local Demo"
	if isNeonConfigured() {
		dbStatus = "Connected to NeonDB PostgreSQL"
	}

	banner := `
============================================================
  📝 THE ELECTRONIC NOTEPAD (GO EDITION)
  • Server listening on: http://localhost:%s
  • Database: %s
  • Engine: Go 1.26 + net/http (Embed single binary)
============================================================
`
	fmt.Printf(banner, port, dbStatus)

	addr := ":" + port
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server stopped with error: %v", err)
	}
}
