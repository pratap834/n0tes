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

  // Link & Selection State
  const [savedRange, setSavedRange] = useState(null);
  const [selectedText, setSelectedText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDisplayText, setLinkDisplayText] = useState('');
  const [activeHoverLink, setActiveHoverLink] = useState(null); // { url, rect, node }

  // Modal State
  const [modalType, setModalType] = useState(null); // 'new-section' | 'rename-section' | 'delete-section' | 'delete-note' | 'insert-link'
  const [modalInputValue, setModalInputValue] = useState('');
  const [targetSection, setTargetSection] = useState(null);

  const saveTimeoutRef = useRef(null);
  const titleInputRef = useRef(null);
  const editorRef = useRef(null);
  const linkInputRef = useRef(null);

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
        setActiveNoteContent(first.content || '');
        if (editorRef.current) {
          editorRef.current.innerHTML = first.content || '';
        }
        setLastSavedTime(new Date(first.updated_at).toLocaleTimeString());
      } else {
        setActiveNoteId(null);
        setActiveNoteTitle('');
        setActiveNoteContent('');
        if (editorRef.current) {
          editorRef.current.innerHTML = '';
        }
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
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      performSave(activeNoteId, activeNoteTitle, activeNoteContent);
    }
    setActiveNoteId(note.id);
    setActiveNoteTitle(note.title);
    setActiveNoteContent(note.content || '');
    if (editorRef.current) {
      editorRef.current.innerHTML = note.content || '';
    }
    setActiveHoverLink(null);
    setSaveStatus('idle');
    setLastSavedTime(new Date(note.updated_at).toLocaleTimeString());
  };

  // Sync editor innerHTML when activeNoteId changes
  useEffect(() => {
    if (editorRef.current && activeNoteContent !== undefined) {
      if (editorRef.current.innerHTML !== activeNoteContent) {
        editorRef.current.innerHTML = activeNoteContent;
      }
    }
  }, [activeNoteId]); // only re-sync on note change

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

  const handleEditorInput = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    setActiveNoteContent(html);
    triggerAutoSave(activeNoteTitle, html);
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
      setActiveNoteContent(newNote.content || '');
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
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
        if (editorRef.current) {
          editorRef.current.innerHTML = '';
        }
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

  // 10. HYPERLINK FEATURE
  const openInsertLinkModal = () => {
    const sel = window.getSelection();
    let text = '';
    let existingUrl = '';

    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      setSavedRange(range.cloneRange());
      text = range.toString();

      // Check if current selection is inside an anchor
      let parent = range.commonAncestorContainer;
      if (parent.nodeType === 3) parent = parent.parentNode;
      const anchor = parent.closest ? parent.closest('a') : null;
      if (anchor) {
        existingUrl = anchor.getAttribute('href') || '';
        if (!text) text = anchor.innerText;
      }
    } else {
      setSavedRange(null);
    }

    setSelectedText(text);
    setLinkDisplayText(text);
    setLinkUrl(existingUrl || 'https://');
    setModalType('insert-link');
    setTimeout(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }, 50);
  };

  const applyHyperlink = () => {
    let cleanUrl = (linkUrl || '').trim();
    if (!cleanUrl) return;

    // Auto prepend https:// if missing protocol
    if (!/^https?:\/\//i.test(cleanUrl) && !cleanUrl.startsWith('#') && !cleanUrl.startsWith('/')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const textToInsert = (linkDisplayText || selectedText || cleanUrl).trim();

    if (savedRange && editorRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);

      // Create anchor element
      const anchor = document.createElement('a');
      anchor.href = cleanUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'retro-hyperlink';
      anchor.innerText = textToInsert;

      savedRange.deleteContents();
      savedRange.insertNode(anchor);

      // Move cursor after the inserted link
      const newRange = document.createRange();
      newRange.setStartAfter(anchor);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else if (editorRef.current) {
      // If no range, append to end
      const anchor = document.createElement('a');
      anchor.href = cleanUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'retro-hyperlink';
      anchor.innerText = textToInsert;
      editorRef.current.appendChild(anchor);
    }

    handleEditorInput();
    setModalType(null);
    setSavedRange(null);
  };

  const removeHyperlink = () => {
    if (activeHoverLink && activeHoverLink.node) {
      const parent = activeHoverLink.node.parentNode;
      while (activeHoverLink.node.firstChild) {
        parent.insertBefore(activeHoverLink.node.firstChild, activeHoverLink.node);
      }
      parent.removeChild(activeHoverLink.node);
      handleEditorInput();
      setActiveHoverLink(null);
      return;
    }

    // Execute standard unlink on selection
    document.execCommand('unlink', false, null);
    handleEditorInput();
  };

  // Keyboard shortcut Ctrl+K / Cmd+K for link
  const handleEditorKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openInsertLinkModal();
    }
  };

  // Handle clicking on links inside the editor
  const handleEditorClick = (e) => {
    const targetAnchor = e.target.closest('a');
    if (targetAnchor) {
      // If holding Ctrl/Cmd, directly open in new tab
      if (e.ctrlKey || e.metaKey) {
        window.open(targetAnchor.href, '_blank', 'noopener,noreferrer');
        return;
      }
      e.preventDefault();
      const rect = targetAnchor.getBoundingClientRect();
      const editorRect = editorRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
      setActiveHoverLink({
        url: targetAnchor.getAttribute('href') || targetAnchor.href,
        node: targetAnchor,
        top: rect.bottom - editorRect.top + 5,
        left: Math.max(10, rect.left - editorRect.left),
      });
    } else {
      setActiveHoverLink(null);
    }
  };

  // Formatting helpers
  const applyFormat = (command) => {
    document.execCommand(command, false, null);
    handleEditorInput();
  };

  // 11. Plaintext Export / Download
  const handleExportText = () => {
    if (!activeNoteTitle && !activeNoteContent) return;
    const activeSection = sections.find((s) => s.id === activeSectionId);
    
    // Clean HTML to text while preserving link URLs
    let cleanBody = activeNoteContent || '';
    cleanBody = cleanBody.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');
    cleanBody = cleanBody.replace(/<br\s*\/?>/gi, '\n');
    cleanBody = cleanBody.replace(/<\/div>/gi, '\n');
    cleanBody = cleanBody.replace(/<\/p>/gi, '\n\n');
    cleanBody = cleanBody.replace(/<[^>]+>/g, '');
    cleanBody = cleanBody.replace(/&nbsp;/g, ' ');
    cleanBody = cleanBody.replace(/&amp;/g, '&');
    cleanBody = cleanBody.replace(/&lt;/g, '<');
    cleanBody = cleanBody.replace(/&gt;/g, '>');

    const textHeader = `========================================\n` +
      `SECTION: ${activeSection?.name || 'General'}\n` +
      `TITLE:   ${activeNoteTitle || 'Untitled Note'}\n` +
      `DATE:    ${new Date().toLocaleString()}\n` +
      `========================================\n\n`;
    const fullText = textHeader + cleanBody;
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
    const raw = activeNoteContent || '';
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = text.length === 0 ? 0 : text.split(/\s+/).length;
    const chars = text.length;
    const lines = raw.split(/<br\s*\/?>|<\/div>|<\/p>/gi).length || 1;
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
                  // Clean preview snippet
                  const snippet = (note.content || '').replace(/<[^>]+>/g, ' ').substring(0, 50);
                  return (
                    <li
                      key={note.id}
                      className={`note-item ${isCurrent ? 'active' : ''}`}
                      onClick={() => selectNote(note)}
                    >
                      <div className="note-item-title">{note.title || 'Untitled Note'}</div>
                      <div className="note-item-meta">
                        <span>{dateStr}</span>
                        <span>{note.content ? `${snippet.split(/\s+/).filter(Boolean).length} words` : 'empty'}</span>
                      </div>
                      {snippet && (
                        <div className="note-item-snippet">
                          {snippet}...
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
                  title="Export note as a .txt file (preserves hyperlinks)"
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

            {/* Inbuilt Retro Formatting Ribbon (Includes Hyperlink Feature) */}
            {activeNoteId && (
              <div className="editor-format-bar">
                <button
                  id="insert-link-btn"
                  className="format-btn"
                  onClick={openInsertLinkModal}
                  title="Add Hyperlink to selected letter, word, or sentence (Ctrl+K)"
                >
                  🔗 Add Link
                </button>
                <button
                  id="remove-link-btn"
                  className="format-btn"
                  onClick={removeHyperlink}
                  title="Remove link from selection"
                >
                  ✕ Unlink
                </button>

                <div className="format-divider"></div>

                <button
                  className="format-btn"
                  onClick={() => applyFormat('bold')}
                  title="Bold (Ctrl+B)"
                  style={{ fontWeight: 'bold' }}
                >
                  B
                </button>
                <button
                  className="format-btn"
                  onClick={() => applyFormat('italic')}
                  title="Italic (Ctrl+I)"
                  style={{ fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}
                >
                  I
                </button>
                <button
                  className="format-btn"
                  onClick={() => applyFormat('underline')}
                  title="Underline (Ctrl+U)"
                  style={{ textDecoration: 'underline' }}
                >
                  U
                </button>

                <div className="format-divider"></div>

                <button
                  className="format-btn"
                  onClick={() => applyFormat('insertUnorderedList')}
                  title="Bullet List"
                >
                  • List
                </button>

                <span style={{ fontSize: '11px', color: '#7a7060', marginLeft: 'auto', fontStyle: 'italic' }}>
                  Tip: Select any word or sentence, then click &quot;🔗 Add Link&quot; or press Ctrl+K
                </span>
              </div>
            )}

            {/* Ruled Yellow Notepad Paper Sheet */}
            {activeNoteId ? (
              <div className="notepad-sheet" style={{ position: 'relative' }}>
                <input
                  ref={titleInputRef}
                  id="note-title"
                  type="text"
                  className="note-title-input"
                  placeholder="Note Title..."
                  value={activeNoteTitle}
                  onChange={handleTitleChange}
                />

                {/* Contenteditable Rich Pad with Hyperlinks */}
                <div
                  ref={editorRef}
                  id="note-content"
                  className="note-content-editable"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Start writing your thoughts here... Select text and press Ctrl+K to attach a hyperlink."
                  onInput={handleEditorInput}
                  onKeyDown={handleEditorKeyDown}
                  onClick={handleEditorClick}
                  spellCheck={false}
                />

                {/* Floating Retro Link Bubble Popover when link is clicked */}
                {activeHoverLink && (
                  <div
                    className="retro-link-popover"
                    style={{
                      top: `${activeHoverLink.top}px`,
                      left: `${activeHoverLink.left}px`,
                    }}
                  >
                    <span>🔗</span>
                    <a
                      href={activeHoverLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-preview"
                      title={activeHoverLink.url}
                    >
                      {activeHoverLink.url}
                    </a>
                    <button
                      className="popover-btn"
                      onClick={() => window.open(activeHoverLink.url, '_blank', 'noopener,noreferrer')}
                      title="Open in new tab"
                    >
                      ↗ Open
                    </button>
                    <button
                      className="popover-btn"
                      onClick={() => {
                        setLinkUrl(activeHoverLink.url);
                        setLinkDisplayText(activeHoverLink.node.innerText);
                        setSelectedText(activeHoverLink.node.innerText);
                        // Save range for replacement
                        const r = document.createRange();
                        r.selectNode(activeHoverLink.node);
                        setSavedRange(r);
                        setModalType('insert-link');
                        setActiveHoverLink(null);
                      }}
                      title="Edit link URL"
                    >
                      ✎ Edit
                    </button>
                    <button
                      className="popover-btn"
                      onClick={removeHyperlink}
                      title="Remove hyperlink"
                    >
                      ✕ Unlink
                    </button>
                  </div>
                )}
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
          <span>Hyperlink Enabled • UTF-8</span>
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
                {modalType === 'insert-link' && '🔗 Inbuilt Hyperlink Creator'}
              </span>
              <button
                className="retro-modal-close-btn"
                onClick={() => setModalType(null)}
              >
                ✕
              </button>
            </div>

            <div className="retro-modal-body">
              {/* INSERT / EDIT HYPERLINK DIALOG */}
              {modalType === 'insert-link' && (
                <>
                  <div style={{ fontSize: '12px', background: '#e9e3d4', padding: '6px 8px', border: '1px inset #fff' }}>
                    <strong>Selected Target Text:</strong>{' '}
                    <span style={{ fontFamily: 'var(--font-typewriter)', color: '#0d3810', fontWeight: 'bold' }}>
                      &quot;{linkDisplayText || selectedText || '(No text selected)'}&quot;
                    </span>
                  </div>

                  {!selectedText && (
                    <>
                      <label htmlFor="link-text-input">Display Text for Link:</label>
                      <input
                        id="link-text-input"
                        type="text"
                        className="retro-input"
                        placeholder="e.g., Click here or Reference Doc"
                        value={linkDisplayText}
                        onChange={(e) => setLinkDisplayText(e.target.value)}
                      />
                    </>
                  )}

                  <label htmlFor="link-url-input">Web Link URL / Address:</label>
                  <input
                    ref={linkInputRef}
                    id="link-url-input"
                    type="text"
                    className="retro-input"
                    placeholder="https://example.com or any web link"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyHyperlink();
                    }}
                  />

                  <div style={{ fontSize: '11px', color: '#685d4f', fontStyle: 'italic' }}>
                    Tip: Links will appear underlined in classic blue. In the editor, click any link to open, edit, or remove it.
                  </div>

                  <div className="retro-modal-actions">
                    <button className="retro-btn" onClick={() => setModalType(null)}>
                      Cancel
                    </button>
                    <button className="retro-btn primary" onClick={applyHyperlink}>
                      🔗 Apply Hyperlink
                    </button>
                  </div>
                </>
              )}

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
