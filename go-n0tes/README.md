# 📝 The Electronic Notepad (Go Edition)

A high-performance reproduction of the vintage electronic notepad built with **Go (Golang)**, connecting to the same **NeonDB** serverless PostgreSQL database.

---

## 🌟 Features

- **Built with Modern Go (1.26)**: Pure `net/http` routing using Go 1.22+ method patterns (`GET /api/sections`, `PATCH /api/notes/{id}`).
- **Embedded Single Binary**: Static HTML, CSS, and JS are compiled directly into the Go executable via `//go:embed static/*`.
- **Shared NeonDB Storage**: Seamlessly queries and updates the same `sections` and `notes` PostgreSQL tables in NeonDB.
- **Inbuilt Hyperlinks**: Select any letter, word, or sentence and press `Ctrl+K` or click `🔗 Add Link` to attach hyperlinks with hover preview and action popovers (`Open`, `Edit`, `Unlink`).
- **Guaranteed Auto-Save**: Auto-saves on typing, section/note switching, and webpage close (`beforeunload`, `pagehide`, `sendBeacon`, `keepalive: true`).
- **Atomic UPSERTs**: Prevents race conditions during simultaneous note creation and typing.
- **Offline / Local Fallback**: Automatically provides in-memory store if `DATABASE_URL` is omitted.

---

## 🚀 Quick Start

### 1. Configure Environment
Create `.env` inside `go-n0tes/` (or copy `.env.example`):
```env
PORT=8080
DATABASE_URL=postgresql://neondb_owner:your_password@ep-sample-pool.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### 2. Download Dependencies
```bash
go mod tidy
```

### 3. Run the Server
```bash
go run .
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## 📦 Building a Standalone Binary

To compile an optimized single executable containing the entire web application and backend:

### On Windows
```bash
go build -ldflags="-s -w" -o notepad.exe .
```
Then run:
```bash
./notepad.exe
```

### For Linux (Docker / VPS / Railway)
```bash
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o notepad-linux .
```
