// ==========================================================================
// THE ELECTRONIC NOTEPAD (GO EDITION) - CLIENT LOGIC
// Sections, Notes, Inbuilt Hyperlinks, Atomic Auto-Save, and NeonDB Sync
// ==========================================================================

(function () {
  'use strict';

  // Application State
  let sections = [];
  let activeSectionId = null;
  let notes = [];
  let activeNoteId = null;
  let searchQuery = '';
  let saveTimeout = null;
  let hasUnsavedChanges = false;
  let savedRange = null;
  let activeHoverLink = null;
  let modalType = null;
  let targetSection = null;

  // DOM Elements
  const sectionTabsBar = document.getElementById('section-tabs-bar');
  const addSectionBtn = document.getElementById('add-section-btn');
  const notesList = document.getElementById('notes-list');
  const searchInput = document.getElementById('search-notes-input');
  const sidebarSectionTitle = document.getElementById('sidebar-section-title');
  const sidebarCount = document.getElementById('sidebar-count');
  const noteTitleInput = document.getElementById('note-title');
  const noteContentDiv = document.getElementById('note-content');
  const newNoteBtn = document.getElementById('new-note-btn');
  const saveNoteBtn = document.getElementById('save-note-btn');
  const deleteNoteBtn = document.getElementById('delete-note-btn');
  const exportNoteBtn = document.getElementById('export-note-btn');
  const printNoteBtn = document.getElementById('print-note-btn');
  const saveIndicator = document.getElementById('save-indicator');
  const linkPopover = document.getElementById('link-popover');
  const popoverLinkPreview = document.getElementById('popover-link-preview');
  const popoverOpenBtn = document.getElementById('popover-open-btn');
  const popoverEditBtn = document.getElementById('popover-edit-btn');
  const popoverUnlinkBtn = document.getElementById('popover-unlink-btn');
  const modalBackdrop = document.getElementById('modal-backdrop');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalCloseBtn = document.getElementById('modal-close-btn');

  // Formatting buttons
  const insertLinkBtn = document.getElementById('insert-link-btn');
  const removeLinkBtn = document.getElementById('remove-link-btn');
  const boldBtn = document.getElementById('bold-btn');
  const italicBtn = document.getElementById('italic-btn');
  const underlineBtn = document.getElementById('underline-btn');
  const bulletBtn = document.getElementById('bullet-btn');

  // Status Bar Elements
  const neonDot = document.getElementById('neon-dot');
  const neonStatusText = document.getElementById('neon-status-text');
  const statusActiveTab = document.getElementById('status-active-tab');
  const statusNotesCount = document.getElementById('status-notes-count');
  const statusWordsCount = document.getElementById('status-words-count');
  const statusLinesCount = document.getElementById('status-lines-count');
  const todayDateSpan = document.getElementById('today-date');
  const neonBanner = document.getElementById('neon-banner');
  const dismissBannerBtn = document.getElementById('dismiss-banner-btn');

  // Set Today's Date
  if (todayDateSpan) {
    const d = new Date();
    todayDateSpan.textContent = `📅 ${d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })}`;
  }

  // 1. Initial Load: Status and Sections
  async function init() {
    try {
      const [statusRes, secRes] = await Promise.all([
        fetch('/api/status').then((r) => r.json()).catch(() => ({ isNeon: false })),
        fetch('/api/sections').then((r) => r.json()).catch(() => ({ sections: [] })),
      ]);

      const isNeon = Boolean(statusRes.isNeon);
      if (neonDot && neonStatusText) {
        neonDot.className = `neon-dot ${isNeon ? 'active' : 'demo'}`;
        neonStatusText.textContent = isNeon ? 'NeonDB: Connected' : 'NeonDB: Local Demo';
      }
      if (!isNeon && neonBanner) {
        neonBanner.style.display = 'flex';
      }

      sections = secRes.sections || [];
      if (sections.length > 0) {
        activeSectionId = sections[0].id;
      }
      renderSections();
      if (activeSectionId) {
        await loadNotes(activeSectionId);
      }
    } catch (err) {
      console.error('Initialization error:', err);
    }
  }

  // 2. Render Folder Tabs
  function renderSections() {
    if (!sectionTabsBar) return;
    sectionTabsBar.innerHTML = '';

    sections.forEach((sec) => {
      const isActive = sec.id === activeSectionId;
      const tab = document.createElement('div');
      tab.className = `section-tab ${isActive ? 'active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');

      const titleSpan = document.createElement('span');
      titleSpan.textContent = `📁 ${sec.name}`;
      tab.appendChild(titleSpan);

      if (isActive) {
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.textContent = notes.length;
        tab.appendChild(badge);
      }

      // Actions (Rename / Delete)
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'section-tab-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'tab-action-btn';
      editBtn.title = 'Rename Section';
      editBtn.textContent = '✎';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        openRenameSectionModal(sec);
      };
      actionsDiv.appendChild(editBtn);

      if (sections.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.className = 'tab-action-btn';
        delBtn.title = 'Delete Section';
        delBtn.textContent = '×';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          openDeleteSectionModal(sec);
        };
        actionsDiv.appendChild(delBtn);
      }

      tab.appendChild(actionsDiv);

      tab.onclick = () => {
        if (activeSectionId !== sec.id) {
          flushPendingSave();
          activeSectionId = sec.id;
          renderSections();
          loadNotes(sec.id);
        }
      };

      sectionTabsBar.appendChild(tab);
    });

    // Append "+ New Tab" button
    const newTabBtn = document.createElement('button');
    newTabBtn.id = 'add-section-btn';
    newTabBtn.className = 'add-section-tab';
    newTabBtn.title = 'Create a new tab section';
    newTabBtn.textContent = '+ New Tab';
    newTabBtn.onclick = () => {
      flushPendingSave();
      openNewSectionModal();
    };
    sectionTabsBar.appendChild(newTabBtn);

    const activeSec = sections.find((s) => s.id === activeSectionId);
    if (sidebarSectionTitle) {
      sidebarSectionTitle.textContent = `Index: ${activeSec ? activeSec.name : 'Section'}`;
    }
    if (statusActiveTab) {
      statusActiveTab.textContent = `Active Tab: ${activeSec ? activeSec.name : 'None'}`;
    }
  }

  // 3. Load Notes for Active Section
  async function loadNotes(sectionId) {
    if (!sectionId) {
      notes = [];
      renderNotesList();
      selectNote(null);
      return;
    }

    try {
      const res = await fetch(`/api/notes?sectionId=${encodeURIComponent(sectionId)}`);
      const data = await res.json();
      notes = data.notes || [];

      // Check localStorage for any crash drafts
      notes = notes.map((n) => {
        try {
          const raw = localStorage.getItem(`n0tes_draft_${n.id}`);
          if (raw) {
            const draft = JSON.parse(raw);
            if (draft.savedAt && draft.savedAt > new Date(n.updated_at).getTime()) {
              return { ...n, title: draft.title || n.title, content: draft.content !== undefined ? draft.content : n.content };
            }
          }
        } catch {}
        return n;
      });

      renderNotesList();

      if (notes.length > 0) {
        selectNote(notes[0]);
      } else {
        selectNote(null);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  }

  // 4. Render Notes List
  function renderNotesList() {
    if (!notesList) return;
    notesList.innerHTML = '';

    const filtered = getFilteredNotes();

    if (sidebarCount) {
      sidebarCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'Entry' : 'Entries'}`;
    }
    if (statusNotesCount) {
      statusNotesCount.textContent = `Notes in Tab: ${notes.length}`;
    }

    if (filtered.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'no-notes-msg';
      emptyLi.textContent = searchQuery
        ? 'No matching notes found.'
        : 'No notes in this section yet.\nClick "New Note" above to write one!';
      notesList.appendChild(emptyLi);
      return;
    }

    filtered.forEach((n) => {
      const li = document.createElement('li');
      li.className = `note-item ${n.id === activeNoteId ? 'active' : ''}`;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'note-item-title';
      titleDiv.textContent = n.title || 'Untitled Note';
      li.appendChild(titleDiv);

      const metaDiv = document.createElement('div');
      metaDiv.className = 'note-item-meta';

      const dateSpan = document.createElement('span');
      dateSpan.textContent = new Date(n.updated_at || n.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      metaDiv.appendChild(dateSpan);

      const cleanText = (n.content || '').replace(/<[^>]+>/g, ' ').trim();
      const wordsCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
      const wordSpan = document.createElement('span');
      wordSpan.textContent = wordsCount > 0 ? `${wordsCount} words` : 'empty';
      metaDiv.appendChild(wordSpan);

      li.appendChild(metaDiv);

      if (cleanText) {
        const snipDiv = document.createElement('div');
        snipDiv.className = 'note-item-snippet';
        snipDiv.textContent = cleanText.substring(0, 50) + '...';
        li.appendChild(snipDiv);
      }

      li.onclick = () => {
        if (activeNoteId !== n.id) {
          flushPendingSave();
          selectNote(n);
        }
      };

      notesList.appendChild(li);
    });
  }

  function getFilteredNotes() {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter((n) => {
      const titleMatch = (n.title || '').toLowerCase().includes(q);
      const contentMatch = (n.content || '').toLowerCase().includes(q);
      return titleMatch || contentMatch;
    });
  }

  // 5. Select Note into Editor
  function selectNote(note) {
    if (!note) {
      activeNoteId = null;
      if (noteTitleInput) {
        noteTitleInput.value = '';
        noteTitleInput.disabled = true;
      }
      if (noteContentDiv) {
        noteContentDiv.innerHTML = '';
        noteContentDiv.setAttribute('contenteditable', 'false');
      }
      if (deleteNoteBtn) deleteNoteBtn.disabled = true;
      if (saveNoteBtn) saveNoteBtn.disabled = true;
      if (exportNoteBtn) exportNoteBtn.disabled = true;
      if (printNoteBtn) printNoteBtn.disabled = true;
      if (saveIndicator) saveIndicator.textContent = '';
      updateStats('');
      hideLinkPopover();
      return;
    }

    activeNoteId = note.id;
    if (noteTitleInput) {
      noteTitleInput.value = note.title || '';
      noteTitleInput.disabled = false;
    }
    if (noteContentDiv) {
      noteContentDiv.innerHTML = note.content || '';
      noteContentDiv.setAttribute('contenteditable', 'true');
    }
    if (deleteNoteBtn) deleteNoteBtn.disabled = false;
    if (saveNoteBtn) saveNoteBtn.disabled = false;
    if (exportNoteBtn) exportNoteBtn.disabled = false;
    if (printNoteBtn) printNoteBtn.disabled = false;

    setSaveStatus('saved', new Date(note.updated_at).toLocaleTimeString());
    updateStats(noteContentDiv ? noteContentDiv.innerText : '');
    hideLinkPopover();
    renderNotesList();
  }

  // 6. Save Note to Go Backend
  async function performSave(noteId, title, content) {
    if (!noteId) return;
    setSaveStatus('saving');

    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: activeSectionId,
          title: title,
          content: content,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('Save error from server:', res.status, errData);
        throw new Error(errData.error || 'Save failed');
      }

      const data = await res.json();
      const updated = data.note;

      notes = notes.map((n) => (n.id === updated.id ? updated : n));
      renderNotesList();

      try {
        localStorage.removeItem(`n0tes_draft_${noteId}`);
      } catch {}

      hasUnsavedChanges = false;
      setSaveStatus('saved', new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Auto-save error:', err);
      setSaveStatus('error');
    }
  }

  function triggerAutoSave() {
    if (!activeNoteId) return;
    hasUnsavedChanges = true;
    setSaveStatus('saving');

    const currentTitle = noteTitleInput ? noteTitleInput.value : '';
    const currentContent = noteContentDiv ? noteContentDiv.innerHTML : '';

    // Instant local backup
    try {
      localStorage.setItem(`n0tes_draft_${activeNoteId}`, JSON.stringify({
        title: currentTitle,
        content: currentContent,
        savedAt: Date.now(),
      }));
    } catch {}

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      performSave(activeNoteId, currentTitle, currentContent);
    }, 600);
  }

  function flushPendingSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    if (hasUnsavedChanges && activeNoteId) {
      const currentTitle = noteTitleInput ? noteTitleInput.value : '';
      const currentContent = noteContentDiv ? noteContentDiv.innerHTML : '';
      performSave(activeNoteId, currentTitle, currentContent);
    }
  }

  // 7. Guaranteed Save on Page Close / Unload
  function saveImmediatelyOnPageClose() {
    if (!activeNoteId || !hasUnsavedChanges) return;

    const currentTitle = noteTitleInput ? noteTitleInput.value : '';
    const currentContent = noteContentDiv ? noteContentDiv.innerHTML : '';

    const payload = JSON.stringify({
      id: activeNoteId,
      sectionId: activeSectionId,
      title: currentTitle,
      content: currentContent,
    });

    // 1. sendBeacon
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/notes/save-beacon', blob);
    }

    // 2. fetch with keepalive: true
    try {
      fetch(`/api/notes/${encodeURIComponent(activeNoteId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      });
    } catch {}

    // 3. localStorage sync backup
    try {
      localStorage.setItem(`n0tes_draft_${activeNoteId}`, JSON.stringify({
        title: currentTitle,
        content: currentContent,
        savedAt: Date.now(),
      }));
    } catch {}

    hasUnsavedChanges = false;
  }

  window.addEventListener('beforeunload', saveImmediatelyOnPageClose);
  window.addEventListener('pagehide', saveImmediatelyOnPageClose);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveImmediatelyOnPageClose();
    }
  });

  // 8. Create New Note
  async function handleCreateNewNote() {
    if (!activeSectionId) return;
    flushPendingSave();

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

    notes.unshift(newNote);
    selectNote(newNote);
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
        notes = notes.map((n) => (n.id === newId ? data.note : n));
        renderNotesList();
        setSaveStatus('saved', new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Failed to create note on server:', err);
    }

    setTimeout(() => {
      if (noteTitleInput) {
        noteTitleInput.focus();
        noteTitleInput.select();
      }
    }, 50);
  }

  // 9. Inbuilt Hyperlink Feature
  function openInsertLinkModal() {
    const sel = window.getSelection();
    let text = '';
    let existingUrl = '';

    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      savedRange = range.cloneRange();
      text = range.toString();

      let parent = range.commonAncestorContainer;
      if (parent.nodeType === 3) parent = parent.parentNode;
      const anchor = parent.closest ? parent.closest('a') : null;
      if (anchor) {
        existingUrl = anchor.getAttribute('href') || '';
        if (!text) text = anchor.innerText;
      }
    } else {
      savedRange = null;
    }

    showModal({
      title: '🔗 Inbuilt Hyperlink Creator',
      html: `
        <div style="font-size: 12px; background: #e9e3d4; padding: 6px 8px; border: 1px inset #fff;">
          <strong>Selected Target Text:</strong>
          <span style="font-family: var(--font-typewriter); color: #0d3810; font-weight: bold;">
            "${escapeHtml(text) || '(No text selected)'}"
          </span>
        </div>
        ${!text ? `
          <label for="link-text-input">Display Text for Link:</label>
          <input id="link-text-input" type="text" class="retro-input" placeholder="e.g. Reference Documentation" />
        ` : ''}
        <label for="link-url-input">Web Link URL / Address:</label>
        <input id="link-url-input" type="text" class="retro-input" placeholder="https://example.com" value="${escapeHtml(existingUrl || 'https://')}" />
        <div style="font-size: 11px; color: #685d4f; font-style: italic;">
          Tip: Links appear underlined in retro blue. Click any link in your note to open, edit, or remove it.
        </div>
        <div class="retro-modal-actions">
          <button id="modal-cancel-btn" class="retro-btn">Cancel</button>
          <button id="modal-apply-link-btn" class="retro-btn primary">🔗 Apply Hyperlink</button>
        </div>
      `,
      onOpen: () => {
        const urlInput = document.getElementById('link-url-input');
        const textInput = document.getElementById('link-text-input');
        const applyBtn = document.getElementById('modal-apply-link-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        if (urlInput) {
          urlInput.focus();
          urlInput.select();
          urlInput.onkeydown = (e) => {
            if (e.key === 'Enter') applyLink();
          };
        }

        cancelBtn.onclick = closeModal;
        applyBtn.onclick = applyLink;

        function applyLink() {
          let cleanUrl = (urlInput ? urlInput.value : '').trim();
          if (!cleanUrl) return;

          if (!/^https?:\/\//i.test(cleanUrl) && !cleanUrl.startsWith('#') && !cleanUrl.startsWith('/')) {
            cleanUrl = 'https://' + cleanUrl;
          }

          const displayText = text || (textInput ? textInput.value.trim() : '') || cleanUrl;

          if (savedRange && noteContentDiv) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedRange);

            const a = document.createElement('a');
            a.href = cleanUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'retro-hyperlink';
            a.innerText = displayText;

            savedRange.deleteContents();
            savedRange.insertNode(a);

            const newRange = document.createRange();
            newRange.setStartAfter(a);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
          } else if (noteContentDiv) {
            const a = document.createElement('a');
            a.href = cleanUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'retro-hyperlink';
            a.innerText = displayText;
            noteContentDiv.appendChild(a);
          }

          triggerAutoSave();
          closeModal();
          savedRange = null;
        }
      },
    });
  }

  function removeHyperlink() {
    if (activeHoverLink && activeHoverLink.node) {
      const parent = activeHoverLink.node.parentNode;
      while (activeHoverLink.node.firstChild) {
        parent.insertBefore(activeHoverLink.node.firstChild, activeHoverLink.node);
      }
      parent.removeChild(activeHoverLink.node);
      hideLinkPopover();
      triggerAutoSave();
      return;
    }
    document.execCommand('unlink', false, null);
    triggerAutoSave();
  }

  // Handle clicking on links inside the note
  if (noteContentDiv) {
    noteContentDiv.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (anchor) {
        // Direct click with Ctrl/Cmd opens link
        if (e.ctrlKey || e.metaKey) {
          window.open(anchor.href, '_blank', 'noopener,noreferrer');
          return;
        }
        e.preventDefault();
        showLinkPopover(anchor);
      } else {
        hideLinkPopover();
      }
    });

    noteContentDiv.addEventListener('input', () => {
      triggerAutoSave();
      updateStats(noteContentDiv.innerText);
    });

    noteContentDiv.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openInsertLinkModal();
      }
    });
  }

  if (noteTitleInput) {
    noteTitleInput.addEventListener('input', () => {
      triggerAutoSave();
      const currentTitle = noteTitleInput.value;
      const note = notes.find((n) => n.id === activeNoteId);
      if (note) {
        note.title = currentTitle;
        renderNotesList();
      }
    });
  }

  // Link Popover Display
  function showLinkPopover(anchor) {
    if (!linkPopover) return;
    const rect = anchor.getBoundingClientRect();
    const containerRect = document.getElementById('notepad-container').getBoundingClientRect();

    const top = rect.bottom - containerRect.top + 5;
    const left = Math.max(10, rect.left - containerRect.left);

    activeHoverLink = {
      url: anchor.getAttribute('href') || anchor.href,
      node: anchor,
    };

    if (popoverLinkPreview) {
      popoverLinkPreview.href = activeHoverLink.url;
      popoverLinkPreview.textContent = activeHoverLink.url;
      popoverLinkPreview.title = activeHoverLink.url;
    }

    linkPopover.style.top = `${top}px`;
    linkPopover.style.left = `${left}px`;
    linkPopover.style.display = 'flex';
  }

  function hideLinkPopover() {
    if (linkPopover) {
      linkPopover.style.display = 'none';
    }
    activeHoverLink = null;
  }

  if (popoverOpenBtn) {
    popoverOpenBtn.onclick = () => {
      if (activeHoverLink) {
        window.open(activeHoverLink.url, '_blank', 'noopener,noreferrer');
      }
    };
  }

  if (popoverEditBtn) {
    popoverEditBtn.onclick = () => {
      if (!activeHoverLink) return;
      const anchor = activeHoverLink.node;
      const r = document.createRange();
      r.selectNode(anchor);
      savedRange = r;
      hideLinkPopover();
      openInsertLinkModal();
    };
  }

  if (popoverUnlinkBtn) {
    popoverUnlinkBtn.onclick = removeHyperlink;
  }

  // Formatting Toolbar Buttons
  if (insertLinkBtn) insertLinkBtn.onclick = openInsertLinkModal;
  if (removeLinkBtn) removeLinkBtn.onclick = removeHyperlink;
  if (boldBtn) boldBtn.onclick = () => { document.execCommand('bold', false, null); triggerAutoSave(); };
  if (italicBtn) italicBtn.onclick = () => { document.execCommand('italic', false, null); triggerAutoSave(); };
  if (underlineBtn) underlineBtn.onclick = () => { document.execCommand('underline', false, null); triggerAutoSave(); };
  if (bulletBtn) bulletBtn.onclick = () => { document.execCommand('insertUnorderedList', false, null); triggerAutoSave(); };

  // Manual Actions
  if (newNoteBtn) newNoteBtn.onclick = handleCreateNewNote;
  if (saveNoteBtn) saveNoteBtn.onclick = flushPendingSave;

  if (deleteNoteBtn) {
    deleteNoteBtn.onclick = () => {
      if (!activeNoteId) return;
      const note = notes.find((n) => n.id === activeNoteId);
      showModal({
        title: 'Confirm Note Deletion',
        html: `
          <p style="font-size: 13px; line-height: 1.5;">
            Are you sure you want to tear out and delete <strong>"${escapeHtml(note ? note.title : 'Untitled Note')}"</strong>?<br/>
            This action cannot be undone.
          </p>
          <div class="retro-modal-actions">
            <button id="modal-cancel-btn" class="retro-btn">Cancel</button>
            <button id="modal-delete-confirm-btn" class="retro-btn danger">Delete Note</button>
          </div>
        `,
        onOpen: () => {
          document.getElementById('modal-cancel-btn').onclick = closeModal;
          document.getElementById('modal-delete-confirm-btn').onclick = async () => {
            try {
              await fetch(`/api/notes/${encodeURIComponent(activeNoteId)}`, { method: 'DELETE' });
              notes = notes.filter((n) => n.id !== activeNoteId);
              renderNotesList();
              selectNote(notes.length > 0 ? notes[0] : null);
              closeModal();
            } catch (err) {
              console.error('Failed to delete note:', err);
              alert('Could not delete note.');
            }
          };
        },
      });
    };
  }

  // 10. Plaintext Export
  if (exportNoteBtn) {
    exportNoteBtn.onclick = () => {
      const title = noteTitleInput ? noteTitleInput.value : 'note';
      const rawHtml = noteContentDiv ? noteContentDiv.innerHTML : '';
      const sec = sections.find((s) => s.id === activeSectionId);

      let cleanBody = rawHtml;
      cleanBody = cleanBody.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');
      cleanBody = cleanBody.replace(/<br\s*\/?>/gi, '\n');
      cleanBody = cleanBody.replace(/<\/div>/gi, '\n');
      cleanBody = cleanBody.replace(/<\/p>/gi, '\n\n');
      cleanBody = cleanBody.replace(/<[^>]+>/g, '');
      cleanBody = cleanBody.replace(/&nbsp;/g, ' ');
      cleanBody = cleanBody.replace(/&amp;/g, '&');
      cleanBody = cleanBody.replace(/&lt;/g, '<');
      cleanBody = cleanBody.replace(/&gt;/g, '>');

      const text = `========================================\n` +
        `SECTION: ${sec ? sec.name : 'General'}\n` +
        `TITLE:   ${title || 'Untitled Note'}\n` +
        `DATE:    ${new Date().toLocaleString()}\n` +
        `========================================\n\n` + cleanBody;

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9_-]/gi, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(a);
    };
  }

  if (printNoteBtn) {
    printNoteBtn.onclick = () => window.print();
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderNotesList();
    });
  }

  if (dismissBannerBtn) {
    dismissBannerBtn.onclick = () => {
      if (neonBanner) neonBanner.style.display = 'none';
    };
  }

  // 11. Section Management Modals
  function openNewSectionModal() {
    showModal({
      title: 'New Section Tab',
      html: `
        <label for="modal-input">Enter Tab / Section Name:</label>
        <input id="modal-input" type="text" class="retro-input" placeholder="e.g. Work, Reading, Archive" />
        <div class="retro-modal-actions">
          <button id="modal-cancel-btn" class="retro-btn">Cancel</button>
          <button id="modal-submit-btn" class="retro-btn primary">Create Tab</button>
        </div>
      `,
      onOpen: () => {
        const input = document.getElementById('modal-input');
        const submit = document.getElementById('modal-submit-btn');
        document.getElementById('modal-cancel-btn').onclick = closeModal;

        input.focus();
        input.onkeydown = (e) => { if (e.key === 'Enter') submit.click(); };

        submit.onclick = async () => {
          const name = input.value.trim();
          if (!name) return;
          try {
            const res = await fetch('/api/sections', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (data.section) {
              sections.push(data.section);
              activeSectionId = data.section.id;
              renderSections();
              loadNotes(activeSectionId);
              closeModal();
            }
          } catch (err) {
            console.error('Failed to create section:', err);
          }
        };
      },
    });
  }

  function openRenameSectionModal(sec) {
    showModal({
      title: `Rename Section: "${escapeHtml(sec.name)}"`,
      html: `
        <label for="modal-input">Update Section Name:</label>
        <input id="modal-input" type="text" class="retro-input" value="${escapeHtml(sec.name)}" />
        <div class="retro-modal-actions">
          <button id="modal-cancel-btn" class="retro-btn">Cancel</button>
          <button id="modal-submit-btn" class="retro-btn primary">Save</button>
        </div>
      `,
      onOpen: () => {
        const input = document.getElementById('modal-input');
        const submit = document.getElementById('modal-submit-btn');
        document.getElementById('modal-cancel-btn').onclick = closeModal;

        input.focus();
        input.select();
        input.onkeydown = (e) => { if (e.key === 'Enter') submit.click(); };

        submit.onclick = async () => {
          const name = input.value.trim();
          if (!name) return;
          try {
            const res = await fetch(`/api/sections/${encodeURIComponent(sec.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (data.section) {
              sections = sections.map((s) => (s.id === data.section.id ? data.section : s));
              renderSections();
              closeModal();
            }
          } catch (err) {
            console.error('Failed to rename section:', err);
          }
        };
      },
    });
  }

  function openDeleteSectionModal(sec) {
    showModal({
      title: 'Confirm Section Deletion',
      html: `
        <p style="font-size: 13px; line-height: 1.5;">
          Are you sure you want to delete the <strong>"${escapeHtml(sec.name)}"</strong> section?<br/>
          All notes stored within this section will be permanently removed.
        </p>
        <div class="retro-modal-actions">
          <button id="modal-cancel-btn" class="retro-btn">Cancel</button>
          <button id="modal-submit-btn" class="retro-btn danger">Delete Section</button>
        </div>
      `,
      onOpen: () => {
        document.getElementById('modal-cancel-btn').onclick = closeModal;
        document.getElementById('modal-submit-btn').onclick = async () => {
          try {
            await fetch(`/api/sections/${encodeURIComponent(sec.id)}`, { method: 'DELETE' });
            sections = sections.filter((s) => s.id !== sec.id);
            if (activeSectionId === sec.id) {
              activeSectionId = sections.length > 0 ? sections[0].id : null;
            }
            renderSections();
            loadNotes(activeSectionId);
            closeModal();
          } catch (err) {
            console.error('Failed to delete section:', err);
          }
        };
      },
    });
  }

  // Modal helpers
  function showModal({ title, html, onOpen }) {
    if (!modalBackdrop || !modalTitle || !modalBody) return;
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBackdrop.style.display = 'flex';
    if (typeof onOpen === 'function') onOpen();
  }

  function closeModal() {
    if (modalBackdrop) modalBackdrop.style.display = 'none';
  }

  if (modalCloseBtn) modalCloseBtn.onclick = closeModal;
  if (modalBackdrop) {
    modalBackdrop.onclick = (e) => {
      if (e.target === modalBackdrop) closeModal();
    };
  }

  // Helpers
  function setSaveStatus(status, timeStr) {
    if (!saveIndicator) return;
    saveIndicator.className = `save-indicator ${status}`;
    if (status === 'saving') {
      saveIndicator.textContent = '⏳ Saving to Neon...';
    } else if (status === 'saved') {
      saveIndicator.textContent = timeStr ? `✓ Saved (${timeStr})` : '✓ Saved';
    } else if (status === 'error') {
      saveIndicator.textContent = '⚠️ Save failed';
    } else {
      saveIndicator.textContent = timeStr ? `Saved: ${timeStr}` : '';
    }
  }

  function updateStats(text) {
    const clean = (text || '').trim();
    const words = clean ? clean.split(/\s+/).filter(Boolean).length : 0;
    const chars = clean.length;
    const lines = clean ? clean.split('\n').length : 0;

    if (statusWordsCount) statusWordsCount.textContent = `Words: ${words}`;
    if (statusLinesCount) statusLinesCount.textContent = `Lines: ${lines}`;
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run on start
  init();
})();
