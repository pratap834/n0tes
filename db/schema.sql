-- NeonDB PostgreSQL Schema for Retro Notepad

-- Enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Sections Table
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notes Table
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Note',
    content TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast query lookup
CREATE INDEX IF NOT EXISTS idx_notes_section_id ON notes(section_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sections_sort_order ON sections(sort_order ASC, created_at ASC);

-- Initial default sections if empty
INSERT INTO sections (id, name, sort_order)
SELECT 'sec-general', 'General', 1
WHERE NOT EXISTS (SELECT 1 FROM sections);

INSERT INTO sections (id, name, sort_order)
SELECT 'sec-todo', 'To-Do & Tasks', 2
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE name = 'To-Do & Tasks');

INSERT INTO sections (id, name, sort_order)
SELECT 'sec-ideas', 'Ideas & Drafts', 3
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE name = 'Ideas & Drafts');

-- Initial welcome note
INSERT INTO notes (section_id, title, content)
SELECT 'sec-general', 'Welcome to Your Notepad', 'Welcome to your electronic notepad!\n\n• Switch between sections using the tabs at the top.\n• Click "New Note" to jot down thoughts.\n• Everything is saved automatically and backed by your NeonDB PostgreSQL database.\n• Use "Print / Export" to grab a clean copy anytime.\n\nEnjoy writing!'
WHERE NOT EXISTS (SELECT 1 FROM notes);
