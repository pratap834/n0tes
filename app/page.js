'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

export default function NotepadApp() {
  const [sections, setSections] = useState([]);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [activeNoteTitle, setActiveNoteTitle] = useState('');
  const [activeNoteContent, setActiveNoteContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [isNeon, setIsNeon] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Modal State
  const [modalType, setModalType] = useState(null); // 'new-section' | 'rename-section' | 'delete-section' | 'delete-note'
  const [modalInputValue, setModalInputValue] = useState('');
  const [targetSection, setTargetSection] = useState(null);

  const saveTimeoutRef = useRef(null);
  const titleInputRef = useRef(null);

  // 1. Fetch initial sections and system status
  const loadSections = useCallback(async () => {
    try {
      const [secRes, statusRes] = await Promise.all([
        fetch('/api/sections'),
        fetch('/api/status')
      ]);

      const secData = await secRes.json();
      const statusData = await statusRes.json();

      setIsNeon(Boolean(statusData?.isNeon));

      if (secData.sections && secData.sections.length > 0) {
        setSections(secData.sections);
        setActiveSectionId((prev) => (prev ? prev : secData.sections[0].id));
      } else {
        setSections([]);
      }
    } catch (err) {
      console.error('Failed to load sections:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSections();
  }, [loadSections]);

  // 2. Load notes when activeSectionId changes
  const loadNotes = useCallback(async (secId) => {
    if (!secId) {
      setNotes([]);
      setActiveNoteId(null);
      return;
    }
    try {
      const res = await fetch(`/api/notes?sectionId=${encodeURIComponent(secId)}`);
      const data = await res.json();
      const loadedNotes = data.notes || [];
      setNotes(loadedNotes);

      if (loadedNotes.length > 0) {
        const first = loadedNotes[0];
        setActiveNoteId(first.id);
        setActiveNoteTitle(first.title);
        setActiveNoteContent(first.content);
        setLastSavedTime(new Date(first.updated_at).toLocaleTimeString());
      } else {
        setActiveNoteId(null);
        setActiveNoteTitle('');
        setActiveNoteContent('');
        setLastSavedTime(null);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  }, []);

  useEffect(() => {
    if (activeSectionId) {
      loadNotes(activeSectionId);
    }
  }, [activeSectionId, loadNotes]);

  // 3. Switch active note
  const selectNote = (note) => {
    // If pending save, flush it
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      performSave(activeNoteId, activeNoteTitle, activeNoteContent);
    }
    setActiveNoteId(note.id);
    setActiveNoteTitle(note.title);
    setActiveNoteContent(note.content);
    setSaveStatus('idle');
    setLastSavedTime(new Date(note.updated_at).toLocaleTimeString());
  };

  // 4. Save note to backend
  const performSave = async (noteId, title, content) => {
    if (!noteId) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      const updated = data.note;

      // Update local notes list
      setNotes((prevNotes) =>
        prevNotes.map((n) => (n.id === updated.id ? updated : n))
      );

      setSaveStatus('saved');
      setLastSavedTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Auto-save error:', err);
      setSaveStatus('error');
    }
  };

  // 5. Debounced auto-save on edit
  const triggerAutoSave = (newTitle, newContent) => {
    if (!activeNoteId) return;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      performSave(activeNoteId, newTitle, newContent);
    }, 800);
  };

  const handleTitleChange = (e) => {
    const val = e.target.value;
    setActiveNoteTitle(val);
    triggerAutoSave(val, activeNoteContent);
  };

  const handleContentChange = (e) => {
    const val = e.target.value;
    setActiveNoteContent(val);
    triggerAutoSave(activeNoteTitle, val);
  };

  // 6. Manual Immediate Save
  const handleManualSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    performSave(activeNoteId, activeNoteTitle, activeNoteContent);
  };

  // 7. Create New Note
  const handleCreateNewNote = async () => {
    if (!activeSectionId) return;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: activeSectionId,
          title: 'Untitled Note',
          content: '',
        }),
      });
      const data = await res.json();
      const newNote = data.note;
      setNotes((prev) => [newNote, ...prev]);
      setActiveNoteId(newNote.id);
      setActiveNoteTitle(newNote.title);
      setActiveNoteContent(newNote.content);
      setSaveStatus('saved');
      setLastSavedTime(new Date().toLocaleTimeString());
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 50);
    } catch (err) {
      console.error('Failed to create note:', err);
      alert('Could not create new note. Please try again.');
    }
  };

  // 8. Delete Note
  const handleDeleteNoteConfirm = async () => {
    if (!activeNoteId) return;
    try {
      await fetch(`/api/notes/${encodeURIComponent(activeNoteId)}`, {
        method: 'DELETE',
      });
      const remaining = notes.filter((n) => n.id !== activeNoteId);
      setNotes(remaining);
      if (remaining.length > 0) {
        selectNote(remaining[0]);
      } else {
        setActiveNoteId(null);
        setActiveNoteTitle('');
        setActiveNoteContent('');
        setLastSavedTime(null);
      }
      setModalType(null);
    } catch (err) {
      console.error('Failed to delete note:', err);
      alert('Could not delete note.');
    }
  };

  // 9. Section Management
  const handleCreateSection = async () => {
    const name = modalInputValue.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      const newSec = data.section;
      setSections((prev) => [...prev, newSec]);
      setActiveSectionId(newSec.id);
      setModalType(null);
      setModalInputValue('');
    } catch (err) {
      console.error('Failed to create section:', err);
      alert('Could not create section.');
    }
  };

  const handleRenameSection = async () => {
    if (!targetSection) return;
    const name = modalInputValue.trim();
    if (!name) return;
    try {
      const res = await fetch(`/api/sections/${encodeURIComponent(targetSection.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      const updated = data.section;
      setSections((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
      setModalType(null);
      setModalInputValue('');
      setTargetSection(null);
    } catch (err) {
      console.error('Failed to rename section:', err);
      alert('Could not rename section.');
    }
  };

  const handleDeleteSection = async () => {
    if (!targetSection) return;
    try {
      await fetch(`/api/sections/${encodeURIComponent(targetSection.id)}`, {
        method: 'DELETE',
      });
      const remaining = sections.filter((s) => s.id !== targetSection.id);
      setSections(remaining);
      if (activeSectionId === targetSection.id) {
        setActiveSectionId(remaining.length > 0 ? remaining[0].id : null);
      }
      setModalType(null);
      setTargetSection(null);
    } catch (err) {
      console.error('Failed to delete section:', err);
      alert('Could not delete section.');
    }
  };

  // 10. Plaintext Export / Download
  const handleExportText = () => {
    if (!activeNoteTitle && !activeNoteContent) return;
    const activeSection = sections.find((s) => s.id === activeSectionId);
    const textHeader = `========================================\n` +
      `SECTION: ${activeSection?.name || 'General'}\n` +
      `TITLE:   ${activeNoteTitle || 'Untitled Note'}\n` +
      `DATE:    ${new Date().toLocaleString()}\n` +
      `========================================\n\n`;
    const fullText = textHeader + activeNoteContent;
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(activeNoteTitle || 'note').replace(/[^a-z0-9_-]/gi, '_')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  // Filtered notes by search
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(
      (n) =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.content && n.content.toLowerCase().includes(q))
    );
  }, [notes, searchQuery]);

  // Word and character count calculation
  const stats = useMemo(() => {
    const text = (activeNoteContent || '').trim();
    const words = text.length === 0 ? 0 : text.split(/\s+/).length;
    const chars = text.length;
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    return { words, chars, lines };
  }, [activeNoteContent]);

  const activeSection = sections.find((s) => s.id === activeSectionId);

  // Today's formatted date
  const todayString = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, []);

  return (
    <div className="desk-wrapper">
      {/* Top Banner if running in demo mode without Neon */}
      {!isNeon && !bannerDismissed && (
        <div className="neon-tip-banner">
          <div>
            <strong>📌 Notice:</strong> Running in <em>Local In-Memory Mode</em>. To connect your <strong>NeonDB</strong>, add <code>DATABASE_URL=postgresql://...</code> to your <code>.env.local</code> or Vercel Environment Variables.
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="tab-action-btn"
            style={{ fontWeight: 'bold' }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Retro Masthead Header */}
      <header className="retro-masthead">
        <div className="masthead-brand">
          <span className="masthead-stamp">Est. 2026</span>
          <div>
            <h1 className="masthead-title">THE NOTEPAD</h1>
            <p className="masthead-subtitle">Personal Electronic Desk Ledger & Sectional Notebook</p>
          </div>
        </div>
        <div className="masthead-actions">
          <span className="masthead-date">📅 {todayString}</span>
          <button
            id="new-note-btn"
            className="retro-btn primary"
            onClick={handleCreateNewNote}
            title="Create a new note in the current section"
          >
            ✏️ New Note
          </button>
        </div>
      </header>

      {/* Main Notebook Binder & Manila Tabs */}
      <main className="notebook-binder">
        {/* Decorative Vintage Binder Rings & Spine */}
        <div className="binder-spine">
          <span>Standard Sectioned Ledger • Heavyweight Stationery</span>
          <div className="binder-rings">
            <div className="binder-ring"></div>
            <div className="binder-ring"></div>
            <div className="binder-ring"></div>
          </div>
          <span>NeonDB Persistent Storage</span>
        </div>

        {/* Section Tabs (Folder Tabs) */}
        <div className="section-tabs-bar" role="tablist">
          {sections.map((sec) => {
            const isActive = sec.id === activeSectionId;
            return (
              <div
                key={sec.id}
                role="tab"
                aria-selected={isActive}
                className={`section-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (activeSectionId !== sec.id) {
                    setActiveSectionId(sec.id);
                  }
                }}
              >
                <span>📁 {sec.name}</span>
                {isActive && (
                  <span className="tab-badge">{notes.length}</span>
                )}
                {/* Section edit / delete buttons */}
                <div className="section-tab-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="tab-action-btn"
                    title="Rename Section"
                    onClick={() => {
                      setTargetSection(sec);
                      setModalInputValue(sec.name);
                      setModalType('rename-section');
                    }}
                  >
                    ✎
                  </button>
                  {sections.length > 1 && (
                    <button
                      className="tab-action-btn"
                      title="Delete Section"
                      onClick={() => {
                        setTargetSection(sec);
                        setModalType('delete-section');
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add New Section Tab */}
          <button
            id="add-section-btn"
            className="add-section-tab"
            onClick={() => {
              setModalInputValue('');
              setModalType('new-section');
            }}
            title="Create a new tab section"
          >
            + New Tab
          </button>
        </div>

        {/* Main Folder Interior: Two Columns (Table of Contents + Ruled Paper Notepad) */}
        <div className="folder-body">
          {/* Left Column: Sidebar Index */}
          <aside className="notes-sidebar">
            <div className="sidebar-header">
              <div className="sidebar-title-row">
                <span className="sidebar-title">Index: {activeSection?.name || 'Section'}</span>
                <span style={{ fontSize: '11px', color: '#685d4f' }}>
                  {filteredNotes.length} {filteredNotes.length === 1 ? 'Entry' : 'Entries'}
                </span>
              </div>
              <input
                id="search-notes-input"
                type="text"
                placeholder="Search notes in tab..."
                className="retro-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Note Listing */}
            <ul className="notes-list">
              {isLoading ? (
                <li className="no-notes-msg">Loading records...</li>
              ) : filteredNotes.length === 0 ? (
                <li className="no-notes-msg">
                  {searchQuery ? 'No matching notes found.' : 'No notes in this section yet.\nClick "New Note" above to write one!'}
                </li>
              ) : (
                filteredNotes.map((note) => {
                  const isCurrent = note.id === activeNoteId;
                  const dateStr = new Date(note.updated_at || note.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  });
                  return (
                    <li
                      key={note.id}
                      className={`note-item ${isCurrent ? 'active' : ''}`}
                      onClick={() => selectNote(note)}
                    >
                      <div className="note-item-title">{note.title || 'Untitled Note'}</div>
                      <div className="note-item-meta">
                        <span>{dateStr}</span>
                        <span>{note.content ? `${note.content.split(/\s+/).filter(Boolean).length} words` : 'empty'}</span>
                      </div>
                      {note.content && (
                        <div className="note-item-snippet">
                          {note.content.substring(0, 50)}...
                        </div>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </aside>

          {/* Right Column: Ruled Legal Pad / Stationery Sheet */}
          <section className="note-editor-pane">
            {/* Editor Action Toolstrip */}
            <div className="editor-toolstrip">
              <div className="toolstrip-left">
                <button
                  id="save-note-btn"
                  className="retro-btn"
                  onClick={handleManualSave}
                  disabled={!activeNoteId}
                  title="Force save note now"
                >
                  💾 Save Note
                </button>
                <button
                  id="export-note-btn"
                  className="retro-btn small"
                  onClick={handleExportText}
                  disabled={!activeNoteId}
                  title="Export note as a .txt file"
                >
                  📥 Export .txt
                </button>
                <button
                  id="print-note-btn"
                  className="retro-btn small"
                  onClick={handlePrint}
                  disabled={!activeNoteId}
                  title="Print note or save to PDF"
                >
                  🖨️ Print
                </button>
              </div>

              <div className="toolstrip-right">
                <div className={`save-indicator ${saveStatus}`}>
                  {saveStatus === 'saving' && '⏳ Saving to Neon...'}
                  {saveStatus === 'saved' && `✓ Saved (${lastSavedTime})`}
                  {saveStatus === 'error' && '⚠️ Save failed'}
                  {saveStatus === 'idle' && lastSavedTime && `Last saved: ${lastSavedTime}`}
                </div>

                {activeNoteId && (
                  <button
                    id="delete-note-btn"
                    className="retro-btn danger small"
                    onClick={() => setModalType('delete-note')}
                    title="Delete this note"
                  >
                    🗑️ Tear Out
                  </button>
                )}
              </div>
            </div>

            {/* Ruled Yellow Notepad Paper Sheet */}
            {activeNoteId ? (
              <div className="notepad-sheet">
                <input
                  ref={titleInputRef}
                  id="note-title"
                  type="text"
                  className="note-title-input"
                  placeholder="Note Title..."
                  value={activeNoteTitle}
                  onChange={handleTitleChange}
                />
                <textarea
                  id="note-content"
                  className="note-content-textarea"
                  placeholder="Start writing your thoughts here..."
                  value={activeNoteContent}
                  onChange={handleContentChange}
                  spellCheck={false}
                />
              </div>
            ) : (
              <div
                className="notepad-sheet"
                style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}
              >
                <p style={{ fontFamily: 'var(--font-typewriter)', color: '#7a7060', fontSize: '14px', lineHeight: '2' }}>
                  No note selected in this section.<br />
                  <button
                    className="retro-btn primary"
                    style={{ marginTop: '12px' }}
                    onClick={handleCreateNewNote}
                  >
                    ✏️ Start a New Note
                  </button>
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Retro Inset Status Bar */}
      <footer className="retro-statusbar">
        <div className="status-panel">
          <span className={`neon-dot ${isNeon ? 'active' : 'demo'}`}></span>
          <span>{isNeon ? 'NeonDB: Connected' : 'NeonDB: Local Demo'}</span>
        </div>
        <div className="status-panel">
          <span>Active Tab: {activeSection?.name || 'None'}</span>
        </div>
        <div className="status-panel">
          <span>Notes in Tab: {notes.length}</span>
        </div>
        <div className="status-panel">
          <span>Words: {stats.words}</span>
        </div>
        <div className="status-panel">
          <span>Lines: {stats.lines}</span>
        </div>
        <div className="status-panel grow" style={{ justifyContent: 'flex-end' }}>
          <span>Plaintext / UTF-8</span>
        </div>
      </footer>

      {/* Classic Windows/System Dialog Modals */}
      {modalType && (
        <div className="retro-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="retro-modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="retro-modal-titlebar">
              <span>
                {modalType === 'new-section' && 'New Section Tab'}
                {modalType === 'rename-section' && `Rename Section: "${targetSection?.name}"`}
                {modalType === 'delete-section' && 'Confirm Section Deletion'}
                {modalType === 'delete-note' && 'Confirm Note Deletion'}
              </span>
              <button
                className="retro-modal-close-btn"
                onClick={() => setModalType(null)}
              >
                ✕
              </button>
            </div>

            <div className="retro-modal-body">
              {modalType === 'new-section' && (
                <>
                  <label htmlFor="section-name-input">Enter Tab / Section Name:</label>
                  <input
                    id="section-name-input"
                    type="text"
                    className="retro-input"
                    autoFocus
                    placeholder="e.g., Work, Reading List, Recipes"
                    value={modalInputValue}
                    onChange={(e) => setModalInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateSection();
                    }}
                  />
                  <div className="retro-modal-actions">
                    <button className="retro-btn" onClick={() => setModalType(null)}>
                      Cancel
                    </button>
                    <button className="retro-btn primary" onClick={handleCreateSection}>
                      Create Tab
                    </button>
                  </div>
                </>
              )}

              {modalType === 'rename-section' && (
                <>
                  <label htmlFor="rename-input">Update Section Name:</label>
                  <input
                    id="rename-input"
                    type="text"
                    className="retro-input"
                    autoFocus
                    value={modalInputValue}
                    onChange={(e) => setModalInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSection();
                    }}
                  />
                  <div className="retro-modal-actions">
                    <button className="retro-btn" onClick={() => setModalType(null)}>
                      Cancel
                    </button>
                    <button className="retro-btn primary" onClick={handleRenameSection}>
                      Save
                    </button>
                  </div>
                </>
              )}

              {modalType === 'delete-section' && (
                <>
                  <p style={{ fontSize: '13px', lineHeight: '1.5' }}>
                    Are you sure you want to delete the <strong>&quot;{targetSection?.name}&quot;</strong> section?
                    All notes stored within this section will be permanently removed.
                  </p>
                  <div className="retro-modal-actions">
                    <button className="retro-btn" onClick={() => setModalType(null)}>
                      Cancel
                    </button>
                    <button className="retro-btn danger" onClick={handleDeleteSection}>
                      Delete Section
                    </button>
                  </div>
                </>
              )}

              {modalType === 'delete-note' && (
                <>
                  <p style={{ fontSize: '13px', lineHeight: '1.5' }}>
                    Are you sure you want to tear out and delete <strong>&quot;{activeNoteTitle || 'Untitled Note'}&quot;</strong>?
                    This action cannot be undone.
                  </p>
                  <div className="retro-modal-actions">
                    <button className="retro-btn" onClick={() => setModalType(null)}>
                      Cancel
                    </button>
                    <button className="retro-btn danger" onClick={handleDeleteNoteConfirm}>
                      Delete Note
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
