'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { exportToDocx, exportToPdf } from '../lib/exportUtils';

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
  const [isExporting, setIsExporting] = useState(false);
  const [theme, setTheme] = useState('classic');

  // Link & Selection State
  const [savedRange, setSavedRange] = useState(null);
  const [selectedText, setSelectedText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDisplayText, setLinkDisplayText] = useState('');
  const [activeHoverLink, setActiveHoverLink] = useState(null); // { url, rect, node }

  // Word-style Image Resizing State
  const [selectedImageNode, setSelectedImageNode] = useState(null);
  const [selectedImageRect, setSelectedImageRect] = useState(null); // { top, left, width, height }

  // Undo / Redo History State
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Modal State
  const [modalType, setModalType] = useState(null); // 'new-section' | 'rename-section' | 'delete-section' | 'delete-note' | 'insert-link'
  const [modalInputValue, setModalInputValue] = useState('');
  const [targetSection, setTargetSection] = useState(null);

  // Refs for bulletproof lifecycle auto-saving on page close / unload
  const saveTimeoutRef = useRef(null);
  const titleInputRef = useRef(null);
  const editorRef = useRef(null);
  const notepadSheetRef = useRef(null);
  const linkInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // History Stack Ref: { [noteId]: { past: [], future: [], current: null } }
  const historyRef = useRef({});
  const typingTimeoutRef = useRef(null);
  const isUndoRedoActionRef = useRef(false);

  const activeNoteIdRef = useRef(activeNoteId);
  const activeNoteTitleRef = useRef(activeNoteTitle);
  const activeNoteContentRef = useRef(activeNoteContent);
  const hasUnsavedChangesRef = useRef(false);

  const activeSectionIdRef = useRef(activeSectionId);

  // In-Memory Section Notes Cache for 0ms Instant Tab Switching
  const notesCacheRef = useRef({}); // { [sectionId]: Note[] }
  const [, setNotesCacheVersion] = useState(0);
  const activeNoteBySectionRef = useRef({}); // { [sectionId]: noteId }

  useEffect(() => {
    activeSectionIdRef.current = activeSectionId;
  }, [activeSectionId]);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  useEffect(() => {
    activeNoteTitleRef.current = activeNoteTitle;
  }, [activeNoteTitle]);

  useEffect(() => {
    activeNoteContentRef.current = activeNoteContent;
  }, [activeNoteContent]);

  // Synchronize and detect active theme
  useEffect(() => {
    try {
      const saved = localStorage.getItem('n0tes_theme');
      const preferred = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'obsidian' : 'classic');
      setTheme(preferred);
      document.documentElement.setAttribute('data-theme', preferred);
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prevTheme) => {
      const nextTheme = prevTheme === 'obsidian' ? 'classic' : 'obsidian';
      try {
        localStorage.setItem('n0tes_theme', nextTheme);
        document.documentElement.setAttribute('data-theme', nextTheme);
      } catch {}
      return nextTheme;
    });
  }, []);

  // Helper to merge local crash recovery drafts
  const applyLocalDrafts = useCallback((rawNotes) => {
    if (typeof window === 'undefined' || !window.localStorage) return rawNotes;
    return rawNotes.map((n) => {
      try {
        const rawDraft = window.localStorage.getItem(`n0tes_draft_${n.id}`);
        if (rawDraft) {
          const draft = JSON.parse(rawDraft);
          if (draft.savedAt && draft.savedAt > new Date(n.updated_at).getTime()) {
            return {
              ...n,
              title: draft.title || n.title,
              content: draft.content !== undefined ? draft.content : n.content,
            };
          }
        }
      } catch {}
      return n;
    });
  }, []);

  // 3. Save note to backend
  const performSave = async (noteId, title, content) => {
    if (!noteId) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          sectionId: activeSectionIdRef.current,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('Save failed with status:', res.status, errData);
        throw new Error(errData.error || 'Save failed');
      }
      const data = await res.json();
      const updated = data.note;

      // Update local notes list and in-memory cache
      setNotes((prevNotes) =>
        prevNotes.map((n) => (n.id === updated.id ? updated : n))
      );
      const secId = updated.section_id || activeSectionIdRef.current;
      if (notesCacheRef.current[secId]) {
        notesCacheRef.current[secId] = notesCacheRef.current[secId].map((n) =>
          n.id === updated.id ? updated : n
        );
      }
      setNotesCacheVersion((v) => v + 1);

      // Clean local storage draft once server save succeeds
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(`n0tes_draft_${noteId}`);
      }

      hasUnsavedChangesRef.current = false;
      setSaveStatus('saved');
      setLastSavedTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Auto-save error:', err);
      setSaveStatus('error');
    }
  };

  // Immediate flush before switching notes or sections
  const flushPendingSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (hasUnsavedChangesRef.current && activeNoteIdRef.current) {
      performSave(
        activeNoteIdRef.current,
        activeNoteTitleRef.current,
        activeNoteContentRef.current
      );
    }
  }, []);

  // 4. Guaranteed Auto-Save When Webpage Closes / Unloads
  const saveImmediatelyOnPageClose = useCallback(() => {
    const noteId = activeNoteIdRef.current;
    const title = activeNoteTitleRef.current;
    const content = activeNoteContentRef.current;
    const sectionId = activeSectionIdRef.current;
    if (!noteId || !hasUnsavedChangesRef.current) return;

    const payload = JSON.stringify({ id: noteId, title, content, sectionId });

    // 1. navigator.sendBeacon: standard browser mechanism for unload saving
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/notes/save-beacon', blob);
    }

    // 2. fetch with keepalive: true (persists across page destruction)
    try {
      fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      });
    } catch (e) {
      // Ignore synchronous catch during unload
    }

    // 3. Instant synchronous backup in localStorage
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(`n0tes_draft_${noteId}`, JSON.stringify({
          title,
          content,
          savedAt: Date.now(),
        }));
      }
    } catch (e) {}

    hasUnsavedChangesRef.current = false;
  }, []);

  // Register unload, pagehide, and visibilitychange event listeners
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveImmediatelyOnPageClose();
    };

    const handlePageHide = () => {
      saveImmediatelyOnPageClose();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveImmediatelyOnPageClose();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [saveImmediatelyOnPageClose]);

  // 6. Debounced auto-save on edit + instant localStorage cache
  const triggerAutoSave = useCallback((newTitle, newContent) => {
    const noteId = activeNoteIdRef.current;
    if (!noteId) return;
    hasUnsavedChangesRef.current = true;
    setSaveStatus('saving');

    // Instant local backup
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(`n0tes_draft_${noteId}`, JSON.stringify({
          title: newTitle,
          content: newContent,
          savedAt: Date.now(),
        }));
      }
    } catch {}

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      performSave(noteId, newTitle, newContent);
    }, 600);
  }, []);

  // 7. Per-Note Undo / Redo History Management
  const getNoteHistory = useCallback((noteId) => {
    if (!noteId) return null;
    if (!historyRef.current[noteId]) {
      historyRef.current[noteId] = {
        past: [],
        future: [],
        current: null,
      };
    }
    return historyRef.current[noteId];
  }, []);

  const updateUndoRedoButtons = useCallback((noteId) => {
    const id = noteId || activeNoteIdRef.current;
    if (!id || !historyRef.current[id]) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const h = historyRef.current[id];
    setCanUndo(h.past.length > 0 || (typingTimeoutRef.current !== null));
    setCanRedo(h.future.length > 0);
  }, []);

  const initNoteHistory = useCallback((noteId, title, content) => {
    if (!noteId) return;
    const h = getNoteHistory(noteId);
    if (!h) return;
    if (!h.current) {
      h.current = { title: title || '', content: content || '' };
      h.past = [];
      h.future = [];
    }
    updateUndoRedoButtons(noteId);
  }, [getNoteHistory, updateUndoRedoButtons]);

  const recordSnapshot = useCallback((newTitle, newContent, immediate = false) => {
    const noteId = activeNoteIdRef.current;
    if (!noteId || isUndoRedoActionRef.current) return;

    const h = getNoteHistory(noteId);
    if (!h) return;

    const title = newTitle !== undefined ? newTitle : (activeNoteTitleRef.current || '');
    const content = newContent !== undefined ? newContent : (editorRef.current ? editorRef.current.innerHTML : (activeNoteContentRef.current || ''));

    if (!h.current) {
      h.current = { title, content };
      updateUndoRedoButtons(noteId);
      return;
    }

    if (h.current.title === title && h.current.content === content) {
      return;
    }

    const doPush = () => {
      h.past.push({ ...h.current });
      if (h.past.length > 60) {
        h.past.shift();
      }
      h.current = { title, content };
      h.future = [];
      updateUndoRedoButtons(noteId);
    };

    if (immediate) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      doPush();
    } else {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        doPush();
        typingTimeoutRef.current = null;
      }, 400);
    }
  }, [getNoteHistory, updateUndoRedoButtons]);

  const undo = useCallback(() => {
    const noteId = activeNoteIdRef.current;
    if (!noteId) return;
    const h = getNoteHistory(noteId);
    if (!h) return;

    // Check if there is an uncommitted typing burst in progress
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      const currentDomContent = editorRef.current ? editorRef.current.innerHTML : (activeNoteContentRef.current || '');
      const currentDomTitle = titleInputRef.current ? titleInputRef.current.value : (activeNoteTitleRef.current || '');

      if (h.current && (h.current.content !== currentDomContent || h.current.title !== currentDomTitle)) {
        h.future.push({ title: currentDomTitle, content: currentDomContent });
        const targetState = { ...h.current };

        isUndoRedoActionRef.current = true;
        setActiveNoteTitle(targetState.title);
        if (titleInputRef.current && titleInputRef.current.value !== targetState.title) {
          titleInputRef.current.value = targetState.title;
        }
        setActiveNoteContent(targetState.content);
        if (editorRef.current && editorRef.current.innerHTML !== targetState.content) {
          editorRef.current.innerHTML = targetState.content;
        }

        if (selectedImageNode) {
          selectedImageNode.classList.remove('selected');
          setSelectedImageNode(null);
          setSelectedImageRect(null);
        }

        triggerAutoSave(targetState.title, targetState.content);
        updateUndoRedoButtons(noteId);

        setTimeout(() => {
          isUndoRedoActionRef.current = false;
        }, 60);
        return;
      }
    }

    if (h.past.length === 0) return;

    const currentDomState = {
      title: activeNoteTitleRef.current || '',
      content: editorRef.current ? editorRef.current.innerHTML : (activeNoteContentRef.current || ''),
    };

    const prevState = h.past.pop();
    h.future.push(currentDomState);
    h.current = { ...prevState };

    isUndoRedoActionRef.current = true;

    setActiveNoteTitle(prevState.title);
    if (titleInputRef.current && titleInputRef.current.value !== prevState.title) {
      titleInputRef.current.value = prevState.title;
    }

    setActiveNoteContent(prevState.content);
    if (editorRef.current && editorRef.current.innerHTML !== prevState.content) {
      editorRef.current.innerHTML = prevState.content;
    }

    if (selectedImageNode) {
      selectedImageNode.classList.remove('selected');
      setSelectedImageNode(null);
      setSelectedImageRect(null);
    }

    triggerAutoSave(prevState.title, prevState.content);
    updateUndoRedoButtons(noteId);

    setTimeout(() => {
      isUndoRedoActionRef.current = false;
    }, 60);
  }, [getNoteHistory, selectedImageNode, updateUndoRedoButtons, triggerAutoSave]);

  const redo = useCallback(() => {
    const noteId = activeNoteIdRef.current;
    if (!noteId) return;
    const h = getNoteHistory(noteId);
    if (!h || h.future.length === 0) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    const currentDomState = {
      title: activeNoteTitleRef.current || '',
      content: editorRef.current ? editorRef.current.innerHTML : (activeNoteContentRef.current || ''),
    };

    const nextState = h.future.pop();
    h.past.push(currentDomState);
    h.current = { ...nextState };

    isUndoRedoActionRef.current = true;

    setActiveNoteTitle(nextState.title);
    if (titleInputRef.current && titleInputRef.current.value !== nextState.title) {
      titleInputRef.current.value = nextState.title;
    }

    setActiveNoteContent(nextState.content);
    if (editorRef.current && editorRef.current.innerHTML !== nextState.content) {
      editorRef.current.innerHTML = nextState.content;
    }

    if (selectedImageNode) {
      selectedImageNode.classList.remove('selected');
      setSelectedImageNode(null);
      setSelectedImageRect(null);
    }

    triggerAutoSave(nextState.title, nextState.content);
    updateUndoRedoButtons(noteId);

    setTimeout(() => {
      isUndoRedoActionRef.current = false;
    }, 60);
  }, [getNoteHistory, selectedImageNode, updateUndoRedoButtons, triggerAutoSave]);

  // Global Shortcut Listener for Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.target && (e.target.closest('.retro-modal') || e.target.closest('.retro-input-modal'))) return;
      if (modalType) return;

      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      if (!isCtrlOrCmd) return;

      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        redo();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [undo, redo, modalType]);

  // 8. Switch active note
  const selectNote = useCallback((note) => {
    flushPendingSave();
    if (!note) {
      setActiveNoteId(null);
      setActiveNoteTitle('');
      setActiveNoteContent('');
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
      setActiveHoverLink(null);
      setSelectedImageNode(null);
      setSelectedImageRect(null);
      setSaveStatus('idle');
      setLastSavedTime(null);
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    setActiveNoteId(note.id);
    setActiveNoteTitle(note.title);
    setActiveNoteContent(note.content || '');
    if (editorRef.current) {
      editorRef.current.innerHTML = note.content || '';
    }
    setActiveHoverLink(null);
    setSelectedImageNode(null);
    setSelectedImageRect(null);
    setSaveStatus('idle');
    setLastSavedTime(new Date(note.updated_at).toLocaleTimeString());
    initNoteHistory(note.id, note.title, note.content || '');
    if (activeSectionIdRef.current) {
      activeNoteBySectionRef.current[activeSectionIdRef.current] = note.id;
    }
  }, [flushPendingSave, initNoteHistory]);

  // 9. Parallel Startup Prefetching for All Sections & Notes
  const loadSections = useCallback(async () => {
    setIsLoading(true);
    try {
      const [secRes, statusRes, notesRes] = await Promise.all([
        fetch('/api/sections').then((r) => r.json()).catch(() => ({ sections: [] })),
        fetch('/api/status').then((r) => r.json()).catch(() => ({ isNeon: false })),
        fetch('/api/notes').then((r) => r.json()).catch(() => ({ notes: [] })),
      ]);

      setIsNeon(Boolean(statusRes?.isNeon));

      const secList = secRes.sections || [];
      setSections(secList);

      const allNotes = applyLocalDrafts(notesRes.notes || []);
      const cache = {};
      secList.forEach((s) => {
        cache[s.id] = [];
      });
      allNotes.forEach((n) => {
        if (!cache[n.section_id]) cache[n.section_id] = [];
        cache[n.section_id].push(n);
      });
      Object.keys(cache).forEach((secId) => {
        cache[secId].sort(
          (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
        );
      });
      notesCacheRef.current = cache;
      setNotesCacheVersion((v) => v + 1);

      const initialSecId = secList.length > 0 ? secList[0].id : null;
      setActiveSectionId(initialSecId);
      activeSectionIdRef.current = initialSecId;

      if (initialSecId) {
        const initialNotes = cache[initialSecId] || [];
        setNotes(initialNotes);
        if (initialNotes.length > 0) {
          const first = initialNotes[0];
          selectNote(first);
        } else {
          selectNote(null);
        }
      }
    } catch (err) {
      console.error('Failed to load initial sections & notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [applyLocalDrafts, selectNote]);

  useEffect(() => {
    loadSections();
  }, [loadSections]);

  // 10. Instant 0ms Section Tab Switch with Background Revalidation
  const switchSection = useCallback((secId) => {
    if (!secId || activeSectionIdRef.current === secId) return;

    // Flush any pending auto-save for current note
    flushPendingSave();

    // Remember currently selected note for this section
    if (activeSectionIdRef.current && activeNoteIdRef.current) {
      activeNoteBySectionRef.current[activeSectionIdRef.current] = activeNoteIdRef.current;
    }

    // Update active section
    setActiveSectionId(secId);
    activeSectionIdRef.current = secId;

    // INSTANT SWITCH (0ms): retrieve from in-memory cache
    const secNotes = notesCacheRef.current[secId] || [];
    setNotes(secNotes);

    const rememberedId = activeNoteBySectionRef.current[secId];
    const targetNote = rememberedId
      ? secNotes.find((n) => n.id === rememberedId) || secNotes[0]
      : secNotes[0];

    selectNote(targetNote || null);

    // Silent background revalidation (stale-while-revalidate, non-blocking)
    fetch(`/api/notes?sectionId=${encodeURIComponent(secId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.notes) {
          const fresh = applyLocalDrafts(data.notes);
          notesCacheRef.current[secId] = fresh;
          if (activeSectionIdRef.current === secId) {
            setNotes(fresh);
          }
          setNotesCacheVersion((v) => v + 1);
        }
      })
      .catch((e) => console.error('Background notes sync error:', e));
  }, [flushPendingSave, selectNote, applyLocalDrafts]);

  // Sync editor innerHTML and history when activeNoteId changes
  useEffect(() => {
    if (editorRef.current && activeNoteContent !== undefined) {
      if (editorRef.current.innerHTML !== activeNoteContent) {
        editorRef.current.innerHTML = activeNoteContent;
      }
    }
    if (activeNoteId) {
      initNoteHistory(activeNoteId, activeNoteTitle, activeNoteContent);
    } else {
      setCanUndo(false);
      setCanRedo(false);
    }
  }, [activeNoteId, activeNoteContent, activeNoteTitle, initNoteHistory]);

  const handleTitleChange = (e) => {
    const val = e.target.value;
    setActiveNoteTitle(val);
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNoteId ? { ...n, title: val } : n))
    );
    if (activeSectionId && notesCacheRef.current[activeSectionId]) {
      notesCacheRef.current[activeSectionId] = notesCacheRef.current[activeSectionId].map((n) =>
        n.id === activeNoteId ? { ...n, title: val } : n
      );
    }
    recordSnapshot(val, activeNoteContentRef.current, false);
    triggerAutoSave(val, activeNoteContentRef.current);
  };

  const handleEditorInput = (immediateSnapshot = false) => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    setActiveNoteContent(html);
    if (activeSectionId && notesCacheRef.current[activeSectionId]) {
      notesCacheRef.current[activeSectionId] = notesCacheRef.current[activeSectionId].map((n) =>
        n.id === activeNoteId ? { ...n, content: html } : n
      );
    }
    recordSnapshot(activeNoteTitleRef.current, html, immediateSnapshot);
    triggerAutoSave(activeNoteTitleRef.current, html);
  };

  // 7. Manual Immediate Save
  const handleManualSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    performSave(activeNoteId, activeNoteTitle, activeNoteContent);
  };

  // 8. Create New Note with Immediate Persistence
  const handleCreateNewNote = async () => {
    if (!activeSectionId) return;
    flushPendingSave();

    // Generate unique ID upfront for 0ms lag
    const newId = 'note-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const initialTitle = 'Untitled Note';
    const initialContent = '';

    const newNote = {
      id: newId,
      section_id: activeSectionId,
      title: initialTitle,
      content: initialContent,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Optimistically update state so user can type immediately
    setNotes((prev) => [newNote, ...prev]);
    if (notesCacheRef.current[activeSectionId]) {
      notesCacheRef.current[activeSectionId] = [newNote, ...notesCacheRef.current[activeSectionId]];
    } else {
      notesCacheRef.current[activeSectionId] = [newNote];
    }
    setNotesCacheVersion((v) => v + 1);
    if (activeSectionId) {
      activeNoteBySectionRef.current[activeSectionId] = newId;
    }
    setActiveNoteId(newId);
    setActiveNoteTitle(initialTitle);
    setActiveNoteContent(initialContent);
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
    setSaveStatus('saving');

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          sectionId: activeSectionId,
          title: initialTitle,
          content: initialContent,
        }),
      });
      const data = await res.json();
      if (data.note) {
        setNotes((prev) => prev.map((n) => (n.id === newId ? data.note : n)));
        setSaveStatus('saved');
        setLastSavedTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Failed to create note in database:', err);
    }

    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 50);
  };

  // 9. Delete Note
  const handleDeleteNoteConfirm = async () => {
    if (!activeNoteId) return;
    try {
      await fetch(`/api/notes/${encodeURIComponent(activeNoteId)}`, {
        method: 'DELETE',
      });
      const remaining = notes.filter((n) => n.id !== activeNoteId);
      setNotes(remaining);
      if (notesCacheRef.current[activeSectionId]) {
        notesCacheRef.current[activeSectionId] = notesCacheRef.current[activeSectionId].filter(
          (n) => n.id !== activeNoteId
        );
      }
      setNotesCacheVersion((v) => v + 1);
      if (remaining.length > 0) {
        selectNote(remaining[0]);
      } else {
        selectNote(null);
      }
      setModalType(null);
    } catch (err) {
      console.error('Failed to delete note:', err);
      alert('Could not delete note.');
    }
  };

  // 10. Section Management
  const handleCreateSection = async () => {
    const name = modalInputValue.trim();
    if (!name) return;
    flushPendingSave();
    try {
      const res = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      const newSec = data.section;
      setSections((prev) => [...prev, newSec]);
      notesCacheRef.current[newSec.id] = [];
      setNotesCacheVersion((v) => v + 1);
      setModalType(null);
      setModalInputValue('');
      switchSection(newSec.id);
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
      delete notesCacheRef.current[targetSection.id];
      delete activeNoteBySectionRef.current[targetSection.id];
      setNotesCacheVersion((v) => v + 1);
      setModalType(null);
      setTargetSection(null);
      if (activeSectionId === targetSection.id) {
        if (remaining.length > 0) {
          switchSection(remaining[0].id);
        } else {
          setActiveSectionId(null);
          setNotes([]);
          selectNote(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete section:', err);
      alert('Could not delete section.');
    }
  };

  // 11. HYPERLINK FEATURE
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

    if (!/^https?:\/\//i.test(cleanUrl) && !cleanUrl.startsWith('#') && !cleanUrl.startsWith('/')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const textToInsert = (linkDisplayText || selectedText || cleanUrl).trim();
    recordSnapshot(activeNoteTitleRef.current, editorRef.current?.innerHTML, true);

    if (savedRange && editorRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);

      const anchor = document.createElement('a');
      anchor.href = cleanUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'retro-hyperlink';
      anchor.innerText = textToInsert;

      savedRange.deleteContents();
      savedRange.insertNode(anchor);

      const newRange = document.createRange();
      newRange.setStartAfter(anchor);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else if (editorRef.current) {
      const anchor = document.createElement('a');
      anchor.href = cleanUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'retro-hyperlink';
      anchor.innerText = textToInsert;
      editorRef.current.appendChild(anchor);
    }

    handleEditorInput(true);
    setModalType(null);
    setSavedRange(null);
  };

  const removeHyperlink = () => {
    recordSnapshot(activeNoteTitleRef.current, editorRef.current?.innerHTML, true);
    if (activeHoverLink && activeHoverLink.node) {
      const parent = activeHoverLink.node.parentNode;
      while (activeHoverLink.node.firstChild) {
        parent.insertBefore(activeHoverLink.node.firstChild, activeHoverLink.node);
      }
      parent.removeChild(activeHoverLink.node);
      handleEditorInput(true);
      setActiveHoverLink(null);
      return;
    }

    document.execCommand('unlink', false, null);
    handleEditorInput(true);
  };

  // Keyboard shortcut Ctrl+K / Cmd+K for link
  const handleEditorKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openInsertLinkModal();
    }
  };

  // 12. Word-Style Interactive Image Resizing & Manipulation
  const updateResizeOverlay = useCallback((imgNode = selectedImageNode) => {
    if (!imgNode || !notepadSheetRef.current) {
      setSelectedImageRect(null);
      return;
    }
    const sheetRect = notepadSheetRef.current.getBoundingClientRect();
    const imgRect = imgNode.getBoundingClientRect();
    setSelectedImageRect({
      top: imgRect.top - sheetRect.top,
      left: imgRect.left - sheetRect.left,
      width: imgRect.width,
      height: imgRect.height,
    });
  }, [selectedImageNode]);

  useEffect(() => {
    if (!selectedImageNode) {
      setSelectedImageRect(null);
      return;
    }

    const handleScrollOrResize = () => {
      updateResizeOverlay(selectedImageNode);
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [selectedImageNode, updateResizeOverlay]);

  useEffect(() => {
    const handleGlobalMouseDown = (e) => {
      if (!selectedImageNode) return;

      if (e.target.closest('.image-resize-overlay') || e.target.closest('.image-resize-toolbar')) {
        return;
      }
      if (e.target === selectedImageNode || (e.target.tagName === 'IMG' && editorRef.current?.contains(e.target))) {
        return;
      }

      selectedImageNode.classList.remove('selected');
      setSelectedImageNode(null);
      setSelectedImageRect(null);
    };

    document.addEventListener('mousedown', handleGlobalMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleGlobalMouseDown);
    };
  }, [selectedImageNode]);

  const deleteSelectedImage = useCallback(() => {
    if (!selectedImageNode) return;
    recordSnapshot(activeNoteTitleRef.current, editorRef.current?.innerHTML, true);
    const img = selectedImageNode;
    img.classList.remove('selected');
    setSelectedImageNode(null);
    setSelectedImageRect(null);
    if (img.parentNode) {
      img.parentNode.removeChild(img);
    }
    handleEditorInput(true);
  }, [selectedImageNode, handleEditorInput, recordSnapshot]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedImageNode) return;

      if (e.key === 'Escape') {
        selectedImageNode.classList.remove('selected');
        setSelectedImageNode(null);
        setSelectedImageRect(null);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteSelectedImage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImageNode, deleteSelectedImage]);

  const applyImageSizePreset = (pct) => {
    if (!selectedImageNode || !editorRef.current) return;
    recordSnapshot(activeNoteTitleRef.current, editorRef.current.innerHTML, true);
    const editorWidth = editorRef.current.clientWidth || 650;
    const newWidth = Math.round((editorWidth - 20) * (pct / 100));
    selectedImageNode.style.width = `${newWidth}px`;
    selectedImageNode.style.height = 'auto';
    selectedImageNode.setAttribute('width', newWidth);
    updateResizeOverlay(selectedImageNode);
    handleEditorInput(true);
  };

  const resetImageSize = () => {
    if (!selectedImageNode || !editorRef.current) return;
    recordSnapshot(activeNoteTitleRef.current, editorRef.current.innerHTML, true);
    if (selectedImageNode.naturalWidth) {
      const maxW = (editorRef.current.clientWidth || 700) - 20;
      const targetW = Math.min(selectedImageNode.naturalWidth, maxW);
      selectedImageNode.style.width = `${targetW}px`;
      selectedImageNode.style.height = 'auto';
      selectedImageNode.setAttribute('width', targetW);
    } else {
      selectedImageNode.style.width = '100%';
      selectedImageNode.style.height = 'auto';
      selectedImageNode.removeAttribute('width');
    }
    updateResizeOverlay(selectedImageNode);
    handleEditorInput(true);
  };

  const applyImageAlign = (alignment) => {
    if (!selectedImageNode || !editorRef.current) return;
    recordSnapshot(activeNoteTitleRef.current, editorRef.current.innerHTML, true);
    selectedImageNode.style.display = 'block';
    if (alignment === 'left') {
      selectedImageNode.style.marginLeft = '0';
      selectedImageNode.style.marginRight = 'auto';
    } else if (alignment === 'center') {
      selectedImageNode.style.marginLeft = 'auto';
      selectedImageNode.style.marginRight = 'auto';
    } else if (alignment === 'right') {
      selectedImageNode.style.marginLeft = 'auto';
      selectedImageNode.style.marginRight = '0';
    }
    updateResizeOverlay(selectedImageNode);
    handleEditorInput(true);
  };

  const handleResizeMouseDown = (e, dir) => {
    e.preventDefault();
    e.stopPropagation();

    if (!selectedImageNode || !notepadSheetRef.current || !editorRef.current) return;

    recordSnapshot(activeNoteTitleRef.current, editorRef.current.innerHTML, true);

    const img = selectedImageNode;
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = img.offsetWidth || img.getBoundingClientRect().width;
    const startHeight = img.offsetHeight || img.getBoundingClientRect().height;
    const aspectRatio = (startWidth > 0 && startHeight > 0) ? (startWidth / startHeight) : 1;

    const maxAllowedWidth = Math.max(200, (editorRef.current.clientWidth || 700) - 10);
    const minWidth = 60;

    const onMouseMove = (moveEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;

      if (dir === 'se') {
        newWidth = startWidth + deltaX;
      } else if (dir === 'sw') {
        newWidth = startWidth - deltaX;
      } else if (dir === 'ne') {
        newWidth = startWidth + deltaX;
      } else if (dir === 'nw') {
        newWidth = startWidth - deltaX;
      } else if (dir === 'e') {
        newWidth = startWidth + deltaX;
      } else if (dir === 'w') {
        newWidth = startWidth - deltaX;
      } else if (dir === 's') {
        newHeight = startHeight + deltaY;
        newWidth = newHeight * aspectRatio;
      } else if (dir === 'n') {
        newHeight = startHeight - deltaY;
        newWidth = newHeight * aspectRatio;
      }

      newWidth = Math.max(minWidth, Math.min(maxAllowedWidth, newWidth));

      img.style.width = `${Math.round(newWidth)}px`;
      img.style.height = 'auto';
      img.setAttribute('width', Math.round(newWidth));

      if (notepadSheetRef.current) {
        const sheetRect = notepadSheetRef.current.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        setSelectedImageRect({
          top: imgRect.top - sheetRect.top,
          left: imgRect.left - sheetRect.left,
          width: imgRect.width,
          height: imgRect.height,
        });
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (notepadSheetRef.current && selectedImageNode) {
        const sheetRect = notepadSheetRef.current.getBoundingClientRect();
        const imgRect = selectedImageNode.getBoundingClientRect();
        setSelectedImageRect({
          top: imgRect.top - sheetRect.top,
          left: imgRect.left - sheetRect.left,
          width: imgRect.width,
          height: imgRect.height,
        });
      }
      handleEditorInput(true);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Handle clicking on links or images inside the editor
  const handleEditorClick = (e) => {
    const targetAnchor = e.target.closest('a');
    const targetImage = e.target.closest('img');

    if (targetAnchor) {
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
      if (selectedImageNode) {
        selectedImageNode.classList.remove('selected');
        setSelectedImageNode(null);
        setSelectedImageRect(null);
      }
      return;
    } else {
      setActiveHoverLink(null);
    }

    if (targetImage && editorRef.current?.contains(targetImage)) {
      e.stopPropagation();
      if (selectedImageNode && selectedImageNode !== targetImage) {
        selectedImageNode.classList.remove('selected');
      }
      targetImage.classList.add('selected');
      setSelectedImageNode(targetImage);
      updateResizeOverlay(targetImage);
      return;
    }

    if (selectedImageNode) {
      selectedImageNode.classList.remove('selected');
      setSelectedImageNode(null);
      setSelectedImageRect(null);
    }
  };

  // Formatting helpers
  const applyFormat = (command) => {
    recordSnapshot(activeNoteTitleRef.current, editorRef.current?.innerHTML, true);
    document.execCommand(command, false, null);
    handleEditorInput(true);
  };

  // 13. Image Insertion & Handling (Evernote-Style Direct Paste & Drag/Drop)
  const insertImageIntoEditor = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (!dataUrl) return;

      if (editorRef.current) {
        editorRef.current.focus();
      }

      const sel = window.getSelection();
      let range = null;
      if (sel && sel.rangeCount > 0) {
        range = sel.getRangeAt(0);
        if (!editorRef.current?.contains(range.commonAncestorContainer)) {
          range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
        }
      } else if (editorRef.current) {
        range = document.createRange();
        range.selectNodeContents(editorRef.current);
        range.collapse(false);
      }

      if (!range) return;

      recordSnapshot(activeNoteTitleRef.current, editorRef.current?.innerHTML, true);

      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = file.name || 'Pasted image';
      img.className = 'retro-note-image';
      img.title = file.name || 'Pasted note image';

      range.deleteContents();
      range.insertNode(img);

      // Add a trailing line break spacer so user can immediately type beneath the image
      const spacer = document.createElement('div');
      spacer.innerHTML = '<br>';
      if (img.nextSibling) {
        img.parentNode.insertBefore(spacer, img.nextSibling);
      } else {
        img.parentNode.appendChild(spacer);
      }

      // Move caret to the line after the image
      const newRange = document.createRange();
      newRange.setStart(spacer, 0);
      newRange.collapse(true);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(newRange);
      }

      // Seamlessly update note state and queue debounced autosave
      handleEditorInput(true);

      // Auto-select newly inserted image so resize handles immediately appear
      setTimeout(() => {
        if (img && editorRef.current?.contains(img)) {
          img.classList.add('selected');
          setSelectedImageNode(img);
          updateResizeOverlay(img);
        }
      }, 50);
    };
    reader.readAsDataURL(file);
  }, [handleEditorInput, updateResizeOverlay, recordSnapshot]);

  const handleEditorPaste = (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const items = Array.from(clipboardData.items || []);
    const imageItem = items.find((it) => it.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) {
        insertImageIntoEditor(file);
      }
      return;
    }

    const files = Array.from(clipboardData.files || []);
    const imageFile = files.find((f) => f.type.startsWith('image/'));
    if (imageFile) {
      e.preventDefault();
      insertImageIntoEditor(imageFile);
      return;
    }
  };

  const handleDragOver = (e) => {
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  };

  const handleDrop = (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const imageFile = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
      if (imageFile) {
        e.preventDefault();
        insertImageIntoEditor(imageFile);
      }
    }
  };

  const handleImageFileSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      insertImageIntoEditor(file);
    }
    e.target.value = '';
  };

  // 13. Document Export Functions (.txt, .docx, .pdf)
  const handleExportText = () => {
    if (!activeNoteTitle && !activeNoteContent) return;
    const activeSection = sections.find((s) => s.id === activeSectionId);
    
    let cleanBody = activeNoteContent || '';
    // Preserve image markers in plaintext export
    cleanBody = cleanBody.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '\n[Image: $1]\n');
    cleanBody = cleanBody.replace(/<img[^>]*>/gi, '\n[Image]\n');
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

  const handleExportDocxClick = async () => {
    if (!activeNoteTitle && !activeNoteContent) return;
    const activeSection = sections.find((s) => s.id === activeSectionId);
    setIsExporting(true);
    try {
      await exportToDocx(
        {
          title: activeNoteTitle,
          content: activeNoteContent,
          updated_at: new Date().toISOString(),
        },
        activeSection?.name || 'General'
      );
    } catch (err) {
      console.error('Failed to export Word document:', err);
      alert('Could not export Word document. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdfClick = async () => {
    if (!activeNoteTitle && !activeNoteContent) return;
    const activeSection = sections.find((s) => s.id === activeSectionId);
    setIsExporting(true);
    try {
      await exportToPdf(
        {
          title: activeNoteTitle,
          content: activeNoteContent,
          updated_at: new Date().toISOString(),
        },
        activeSection?.name || 'General'
      );
    } catch (err) {
      console.error('Failed to export PDF document:', err);
      alert('Could not export PDF document. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Filtered notes by search
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter((n) => {
      const titleMatch = (n.title && n.title.toLowerCase().includes(q));
      if (titleMatch) return true;
      if (!n.content) return false;
      const clean = n.content.includes('data:image/')
        ? n.content.replace(/src="data:image\/[^"]+"/gi, '')
        : n.content;
      return clean.toLowerCase().includes(q);
    });
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
          <button
            id="theme-toggle-btn"
            className="retro-btn"
            onClick={toggleTheme}
            title="Switch between Classic Manila and Obsidian Desk Dark Mode"
          >
            {theme === 'obsidian' ? '☀️ Classic Manila' : '🌙 Obsidian Desk'}
          </button>
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
            const count = (notesCacheRef.current[sec.id] || (isActive ? notes : [])).length;
            return (
              <div
                key={sec.id}
                role="tab"
                aria-selected={isActive}
                className={`section-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  switchSection(sec.id);
                }}
              >
                <span>📁 {sec.name}</span>
                <span className="tab-badge">{count}</span>
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
              flushPendingSave();
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
                  const cleanContent = note.content && note.content.includes('data:image/')
                    ? note.content.replace(/src="data:image\/[^"]+"/gi, '')
                    : (note.content || '');
                  const cleanText = cleanContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                  const snippet = cleanText.slice(0, 55);
                  const wordsCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
                  return (
                    <li
                      key={note.id}
                      className={`note-item ${isCurrent ? 'active' : ''}`}
                      onClick={() => selectNote(note)}
                    >
                      <div className="note-item-title">{note.title || 'Untitled Note'}</div>
                      <div className="note-item-meta">
                        <span>{dateStr}</span>
                        <span>{wordsCount > 0 ? `${wordsCount} words` : 'empty'}</span>
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
                  id="export-docx-btn"
                  className="retro-btn small"
                  onClick={handleExportDocxClick}
                  disabled={!activeNoteId || isExporting}
                  title="Export note as a formatted Word Document (.docx)"
                >
                  {isExporting ? '⏳ Exporting...' : '📄 Export .docx'}
                </button>
                <button
                  id="export-pdf-btn"
                  className="retro-btn small"
                  onClick={handleExportPdfClick}
                  disabled={!activeNoteId || isExporting}
                  title="Export note as a high-fidelity PDF (.pdf)"
                >
                  {isExporting ? '⏳ Exporting...' : '📑 Export .pdf'}
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
                  {saveStatus === 'saved' && `✓ Autosaved (${lastSavedTime})`}
                  {saveStatus === 'error' && '⚠️ Save failed'}
                  {saveStatus === 'idle' && lastSavedTime && `Saved: ${lastSavedTime}`}
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
                  id="undo-btn"
                  className="format-btn"
                  onClick={undo}
                  disabled={!canUndo}
                  title="Undo last change (Ctrl+Z)"
                >
                  ↶ Undo
                </button>
                <button
                  id="redo-btn"
                  className="format-btn"
                  onClick={redo}
                  disabled={!canRedo}
                  title="Redo undone change (Ctrl+Y or Ctrl+Shift+Z)"
                >
                  ↷ Redo
                </button>

                <div className="format-divider"></div>

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

                <div className="format-divider"></div>

                <button
                  id="insert-image-btn"
                  className="format-btn"
                  onClick={() => imageInputRef.current?.click()}
                  title="Insert Image (or paste directly via Ctrl+V)"
                >
                  🖼️ Image
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageFileSelect}
                />

                <span style={{ fontSize: '11px', color: '#7a7060', marginLeft: 'auto', fontStyle: 'italic' }}>
                  🛡️ Auto-saves continuously &amp; on page close
                </span>
              </div>
            )}

            {/* Ruled Yellow Notepad Paper Sheet */}
            {activeNoteId ? (
              <div ref={notepadSheetRef} className="notepad-sheet" style={{ position: 'relative' }}>
                <input
                  ref={titleInputRef}
                  id="note-title"
                  type="text"
                  className="note-title-input"
                  placeholder="Note Title..."
                  value={activeNoteTitle}
                  onChange={handleTitleChange}
                />

                {/* Contenteditable Rich Pad with Hyperlinks & Image Pasting */}
                <div
                  ref={editorRef}
                  id="note-content"
                  className="note-content-editable"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Start writing your thoughts here... Paste images directly (Ctrl+V) or select text and press Ctrl+K to attach a hyperlink."
                  onInput={handleEditorInput}
                  onKeyDown={handleEditorKeyDown}
                  onClick={handleEditorClick}
                  onPaste={handleEditorPaste}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
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

                {/* Word-style Interactive Image Resizer Overlay */}
                {selectedImageRect && selectedImageNode && (
                  <div
                    className="image-resize-overlay"
                    style={{
                      top: `${selectedImageRect.top}px`,
                      left: `${selectedImageRect.left}px`,
                      width: `${selectedImageRect.width}px`,
                      height: `${selectedImageRect.height}px`,
                    }}
                  >
                    {/* Floating Word-style Format Toolbar */}
                    <div
                      className="image-resize-toolbar"
                      style={{
                        top: selectedImageRect.top < 45 ? '100%' : '-38px',
                        marginTop: selectedImageRect.top < 45 ? '6px' : '0',
                      }}
                    >
                      <span className="img-tool-badge">
                        {Math.round(selectedImageRect.width)} × {Math.round(selectedImageRect.height)} px
                      </span>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={() => applyImageSizePreset(25)}
                        title="Resize to 25% width"
                      >
                        25%
                      </button>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={() => applyImageSizePreset(50)}
                        title="Resize to 50% width"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={() => applyImageSizePreset(75)}
                        title="Resize to 75% width"
                      >
                        75%
                      </button>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={() => applyImageSizePreset(100)}
                        title="Resize to 100% full width"
                      >
                        100%
                      </button>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={resetImageSize}
                        title="Restore original natural dimensions"
                      >
                        Original
                      </button>
                      <span style={{ color: '#aaa', margin: '0 2px' }}>|</span>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={() => applyImageAlign('left')}
                        title="Align left"
                      >
                        ⬅ Left
                      </button>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={() => applyImageAlign('center')}
                        title="Align center"
                      >
                        ↔ Center
                      </button>
                      <button
                        type="button"
                        className="img-tool-btn"
                        onClick={() => applyImageAlign('right')}
                        title="Align right"
                      >
                        ➡ Right
                      </button>
                      <span style={{ color: '#aaa', margin: '0 2px' }}>|</span>
                      <button
                        type="button"
                        className="img-tool-btn danger"
                        onClick={deleteSelectedImage}
                        title="Delete image (or press Delete key)"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* 8 Word-style Resize Handles */}
                    <div className="resize-handle nw" onMouseDown={(e) => handleResizeMouseDown(e, 'nw')} />
                    <div className="resize-handle n"  onMouseDown={(e) => handleResizeMouseDown(e, 'n')} />
                    <div className="resize-handle ne" onMouseDown={(e) => handleResizeMouseDown(e, 'ne')} />
                    <div className="resize-handle e"  onMouseDown={(e) => handleResizeMouseDown(e, 'e')} />
                    <div className="resize-handle se" onMouseDown={(e) => handleResizeMouseDown(e, 'se')} />
                    <div className="resize-handle s"  onMouseDown={(e) => handleResizeMouseDown(e, 's')} />
                    <div className="resize-handle sw" onMouseDown={(e) => handleResizeMouseDown(e, 'sw')} />
                    <div className="resize-handle w"  onMouseDown={(e) => handleResizeMouseDown(e, 'w')} />
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
        <div className="status-panel">
          <span>🛡️ Auto-Save: Active (On Edit &amp; Close)</span>
        </div>
        <div className="status-panel grow" style={{ justifyContent: 'flex-end' }}>
          <span>UTF-8 • Hyperlink Enabled</span>
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
