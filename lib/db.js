import { neon } from '@neondatabase/serverless';

let sqlClient = null;
let dbInitialized = false;

// In-memory fallback if DATABASE_URL is not yet provided
const memoryStore = {
  sections: [
    { id: 'sec-general', name: 'General', sort_order: 1, created_at: new Date().toISOString() },
    { id: 'sec-todo', name: 'To-Do & Tasks', sort_order: 2, created_at: new Date().toISOString() },
    { id: 'sec-ideas', name: 'Ideas & Drafts', sort_order: 3, created_at: new Date().toISOString() },
  ],
  notes: [
    {
      id: 'note-welcome-1',
      section_id: 'sec-general',
      title: 'Welcome to Your Notepad',
      content: 'Welcome to your electronic notepad!\n\n• Switch between sections using the tabs at the top.\n• Click "New Note" to jot down thoughts.\n• Add your DATABASE_URL in .env.local or Vercel Environment Variables to sync seamlessly with NeonDB.\n• Use "Print / Export" to get a clean plaintext copy anytime.\n\nEnjoy writing!',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'note-sample-2',
      section_id: 'sec-todo',
      title: 'Groceries & Chores',
      content: '[ ] Milk & Eggs\n[ ] Fresh roasted coffee beans\n[ ] Call the library\n[x] Back up database to Neon',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  ]
};

export function isNeonConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

export function getDb() {
  if (!isNeonConfigured()) {
    return null;
  }
  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

export async function initDatabase() {
  if (!isNeonConfigured()) {
    return { isNeon: false, initialized: true };
  }
  if (dbInitialized) {
    return { isNeon: true, initialized: true };
  }

  const sql = getDb();
  try {
    // 1. Create sections table
    await sql`
      CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 2. Create notes table
    await sql`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL DEFAULT 'Untitled Note',
        content TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 3. Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_notes_section_id ON notes(section_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sections_sort_order ON sections(sort_order ASC, created_at ASC);`;

    // 4. Seed initial sections if empty
    const existingSections = await sql`SELECT id FROM sections LIMIT 1;`;
    if (existingSections.length === 0) {
      await sql`
        INSERT INTO sections (id, name, sort_order) VALUES
        ('sec-general', 'General', 1),
        ('sec-todo', 'To-Do & Tasks', 2),
        ('sec-ideas', 'Ideas & Drafts', 3);
      `;
      await sql`
        INSERT INTO notes (id, section_id, title, content) VALUES
        ('note-welcome', 'sec-general', 'Welcome to Your Notepad', 'Welcome to your electronic notepad!\n\n• Switch between sections using the tabs at the top.\n• Click "New Note" to jot down thoughts.\n• Fully backed by your serverless NeonDB PostgreSQL database!\n• Use "Print / Export" to save or print clean copies anytime.\n\nEnjoy writing!');
      `;
    }

    dbInitialized = true;
    return { isNeon: true, initialized: true };
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Data Access Object (DAO) that works seamlessly with NeonDB and falls back gracefully to in-memory store
export const dao = {
  // SECTIONS
  async getSections() {
    if (!isNeonConfigured()) {
      return [...memoryStore.sections].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
    await initDatabase();
    const sql = getDb();
    const rows = await sql`SELECT * FROM sections ORDER BY sort_order ASC, created_at ASC;`;
    return rows;
  },

  async createSection(name) {
    const trimmedName = (name || '').trim() || 'Untitled Section';
    const id = 'sec-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    
    if (!isNeonConfigured()) {
      const newSec = {
        id,
        name: trimmedName,
        sort_order: memoryStore.sections.length + 1,
        created_at: new Date().toISOString(),
      };
      memoryStore.sections.push(newSec);
      return newSec;
    }
    await initDatabase();
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO sections (id, name, sort_order)
      VALUES (${id}, ${trimmedName}, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sections))
      RETURNING *;
    `;
    return row;
  },

  async updateSection(id, name) {
    const trimmedName = (name || '').trim();
    if (!isNeonConfigured()) {
      const sec = memoryStore.sections.find((s) => s.id === id);
      if (sec && trimmedName) {
        sec.name = trimmedName;
      }
      return sec;
    }
    await initDatabase();
    const sql = getDb();
    const [row] = await sql`
      UPDATE sections
      SET name = ${trimmedName}
      WHERE id = ${id}
      RETURNING *;
    `;
    return row;
  },

  async deleteSection(id) {
    if (!isNeonConfigured()) {
      memoryStore.sections = memoryStore.sections.filter((s) => s.id !== id);
      memoryStore.notes = memoryStore.notes.filter((n) => n.section_id !== id);
      return { success: true };
    }
    await initDatabase();
    const sql = getDb();
    await sql`DELETE FROM sections WHERE id = ${id};`;
    return { success: true };
  },

  // NOTES
  async getNotes(sectionId) {
    if (!isNeonConfigured()) {
      return memoryStore.notes
        .filter((n) => n.section_id === sectionId)
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }
    await initDatabase();
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM notes
      WHERE section_id = ${sectionId}
      ORDER BY updated_at DESC;
    `;
    return rows;
  },

  async createNote(sectionId, title = 'Untitled Note', content = '') {
    const id = 'note-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const now = new Date().toISOString();

    if (!isNeonConfigured()) {
      const newNote = {
        id,
        section_id: sectionId,
        title: title.trim() || 'Untitled Note',
        content: content || '',
        created_at: now,
        updated_at: now,
      };
      memoryStore.notes.unshift(newNote);
      return newNote;
    }
    await initDatabase();
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO notes (id, section_id, title, content, created_at, updated_at)
      VALUES (${id}, ${sectionId}, ${title.trim() || 'Untitled Note'}, ${content || ''}, NOW(), NOW())
      RETURNING *;
    `;
    return row;
  },

  async updateNote(id, { title, content }) {
    if (!isNeonConfigured()) {
      const note = memoryStore.notes.find((n) => n.id === id);
      if (!note) return null;
      if (title !== undefined) note.title = title;
      if (content !== undefined) note.content = content;
      note.updated_at = new Date().toISOString();
      return note;
    }
    await initDatabase();
    const sql = getDb();
    const [row] = await sql`
      UPDATE notes
      SET 
        title = COALESCE(${title !== undefined ? title : null}, title),
        content = COALESCE(${content !== undefined ? content : null}, content),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *;
    `;
    return row;
  },

  async deleteNote(id) {
    if (!isNeonConfigured()) {
      memoryStore.notes = memoryStore.notes.filter((n) => n.id !== id);
      return { success: true };
    }
    await initDatabase();
    const sql = getDb();
    await sql`DELETE FROM notes WHERE id = ${id};`;
    return { success: true };
  }
};
