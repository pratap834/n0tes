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
  const exportDocxBtn = document.getElementById('export-docx-btn');
  const exportPdfBtn = document.getElementById('export-pdf-btn');
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
  const insertImageBtn = document.getElementById('insert-image-btn');
  const imageFileInput = document.getElementById('image-file-input');

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
      deselectImage();
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
    deselectImage();
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

  // Word-Style Image Resizer for Go Edition
  let selectedImageNode = null;
  let resizeOverlayEl = null;

  function createResizeOverlay() {
    if (resizeOverlayEl) return resizeOverlayEl;
    const container = document.getElementById('notepad-container');
    if (!container) return null;

    const overlay = document.createElement('div');
    overlay.className = 'image-resize-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="image-resize-toolbar">
        <span class="img-tool-badge" id="img-dim-badge">0 × 0 px</span>
        <button type="button" class="img-tool-btn" data-preset="25" title="Resize to 25% width">25%</button>
        <button type="button" class="img-tool-btn" data-preset="50" title="Resize to 50% width">50%</button>
        <button type="button" class="img-tool-btn" data-preset="75" title="Resize to 75% width">75%</button>
        <button type="button" class="img-tool-btn" data-preset="100" title="Resize to 100% full width">100%</button>
        <button type="button" class="img-tool-btn" id="img-reset-btn" title="Restore original natural dimensions">Original</button>
        <span style="color: #aaa; margin: 0 2px;">|</span>
        <button type="button" class="img-tool-btn" data-align="left" title="Align left">⬅ Left</button>
        <button type="button" class="img-tool-btn" data-align="center" title="Align center">↔ Center</button>
        <button type="button" class="img-tool-btn" data-align="right" title="Align right">➡ Right</button>
        <span style="color: #aaa; margin: 0 2px;">|</span>
        <button type="button" class="img-tool-btn danger" id="img-delete-btn" title="Delete image">🗑️</button>
      </div>
      <div class="resize-handle nw" data-dir="nw"></div>
      <div class="resize-handle n" data-dir="n"></div>
      <div class="resize-handle ne" data-dir="ne"></div>
      <div class="resize-handle e" data-dir="e"></div>
      <div class="resize-handle se" data-dir="se"></div>
      <div class="resize-handle s" data-dir="s"></div>
      <div class="resize-handle sw" data-dir="sw"></div>
      <div class="resize-handle w" data-dir="w"></div>
    `;

    container.appendChild(overlay);
    resizeOverlayEl = overlay;

    // Sizing Presets
    overlay.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (!selectedImageNode || !noteContentDiv) return;
        const pct = parseInt(btn.getAttribute('data-preset'), 10);
        const w = Math.round((noteContentDiv.clientWidth - 20) * (pct / 100));
        selectedImageNode.style.width = w + 'px';
        selectedImageNode.style.height = 'auto';
        selectedImageNode.setAttribute('width', w);
        updateResizeOverlay();
        triggerAutoSave();
      };
    });

    const resetBtn = overlay.querySelector('#img-reset-btn');
    if (resetBtn) {
      resetBtn.onclick = (e) => {
        e.stopPropagation();
        if (!selectedImageNode) return;
        if (selectedImageNode.naturalWidth) {
          const maxW = (noteContentDiv?.clientWidth || 700) - 20;
          const targetW = Math.min(selectedImageNode.naturalWidth, maxW);
          selectedImageNode.style.width = targetW + 'px';
          selectedImageNode.style.height = 'auto';
          selectedImageNode.setAttribute('width', targetW);
        } else {
          selectedImageNode.style.width = '100%';
          selectedImageNode.style.height = 'auto';
          selectedImageNode.removeAttribute('width');
        }
        updateResizeOverlay();
        triggerAutoSave();
      };
    }

    // Alignment
    overlay.querySelectorAll('[data-align]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (!selectedImageNode) return;
        const align = btn.getAttribute('data-align');
        selectedImageNode.style.display = 'block';
        if (align === 'left') {
          selectedImageNode.style.marginLeft = '0';
          selectedImageNode.style.marginRight = 'auto';
        } else if (align === 'center') {
          selectedImageNode.style.marginLeft = 'auto';
          selectedImageNode.style.marginRight = 'auto';
        } else if (align === 'right') {
          selectedImageNode.style.marginLeft = 'auto';
          selectedImageNode.style.marginRight = '0';
        }
        updateResizeOverlay();
        triggerAutoSave();
      };
    });

    // Delete
    const delBtn = overlay.querySelector('#img-delete-btn');
    if (delBtn) {
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteSelectedImage();
      };
    }

    // Handles
    overlay.querySelectorAll('.resize-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dir = handle.getAttribute('data-dir');
        startResizeDrag(e, dir);
      });
    });

    return overlay;
  }

  function updateResizeOverlay() {
    if (!selectedImageNode || !resizeOverlayEl) return;
    const container = document.getElementById('notepad-container');
    if (!container) return;

    const sheetRect = container.getBoundingClientRect();
    const imgRect = selectedImageNode.getBoundingClientRect();

    const top = imgRect.top - sheetRect.top;
    const left = imgRect.left - sheetRect.left;
    const width = imgRect.width;
    const height = imgRect.height;

    resizeOverlayEl.style.top = top + 'px';
    resizeOverlayEl.style.left = left + 'px';
    resizeOverlayEl.style.width = width + 'px';
    resizeOverlayEl.style.height = height + 'px';
    resizeOverlayEl.style.display = 'block';

    const badge = resizeOverlayEl.querySelector('#img-dim-badge');
    if (badge) {
      badge.textContent = `${Math.round(width)} × ${Math.round(height)} px`;
    }

    const toolbar = resizeOverlayEl.querySelector('.image-resize-toolbar');
    if (toolbar) {
      if (top < 45) {
        toolbar.style.top = '100%';
        toolbar.style.marginTop = '6px';
      } else {
        toolbar.style.top = '-38px';
        toolbar.style.marginTop = '0';
      }
    }
  }

  function selectImage(img) {
    if (selectedImageNode && selectedImageNode !== img) {
      selectedImageNode.classList.remove('selected');
    }
    selectedImageNode = img;
    img.classList.add('selected');
    createResizeOverlay();
    updateResizeOverlay();
  }

  function deselectImage() {
    if (selectedImageNode) {
      selectedImageNode.classList.remove('selected');
      selectedImageNode = null;
    }
    if (resizeOverlayEl) {
      resizeOverlayEl.style.display = 'none';
    }
  }

  function deleteSelectedImage() {
    if (!selectedImageNode) return;
    const img = selectedImageNode;
    deselectImage();
    if (img.parentNode) {
      img.parentNode.removeChild(img);
    }
    triggerAutoSave();
    if (noteContentDiv) {
      updateStats(noteContentDiv.innerText);
    }
  }

  function startResizeDrag(e, dir) {
    if (!selectedImageNode) return;
    const container = document.getElementById('notepad-container');
    if (!container) return;

    const img = selectedImageNode;
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = img.offsetWidth || img.getBoundingClientRect().width;
    const startHeight = img.offsetHeight || img.getBoundingClientRect().height;
    const aspectRatio = (startWidth > 0 && startHeight > 0) ? (startWidth / startHeight) : 1;
    const maxAllowedWidth = Math.max(200, (noteContentDiv?.clientWidth || 700) - 10);
    const minWidth = 60;

    function onMouseMove(moveEvent) {
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

      img.style.width = Math.round(newWidth) + 'px';
      img.style.height = 'auto';
      img.setAttribute('width', Math.round(newWidth));

      updateResizeOverlay();
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      updateResizeOverlay();
      triggerAutoSave();
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Handle clicking on links or images inside the note
  if (noteContentDiv) {
    noteContentDiv.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      const targetImg = e.target.closest('img');

      if (anchor) {
        if (e.ctrlKey || e.metaKey) {
          window.open(anchor.href, '_blank', 'noopener,noreferrer');
          return;
        }
        e.preventDefault();
        deselectImage();
        showLinkPopover(anchor);
        return;
      } else {
        hideLinkPopover();
      }

      if (targetImg && noteContentDiv.contains(targetImg)) {
        e.stopPropagation();
        selectImage(targetImg);
        return;
      }

      deselectImage();
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

    // Evernote-Style Direct Image Pasting
    noteContentDiv.addEventListener('paste', (e) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      const items = Array.from(clipboardData.items || []);
      const imageItem = items.find((it) => it.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file) insertImageIntoEditor(file);
        return;
      }

      const files = Array.from(clipboardData.files || []);
      const imageFile = files.find((f) => f.type.startsWith('image/'));
      if (imageFile) {
        e.preventDefault();
        insertImageIntoEditor(imageFile);
        return;
      }
    });

    noteContentDiv.addEventListener('dragover', (e) => {
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    });

    noteContentDiv.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const imageFile = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
        if (imageFile) {
          e.preventDefault();
          insertImageIntoEditor(imageFile);
        }
      }
    });
  }

  // Deselect image on global clicks outside
  document.addEventListener('mousedown', (e) => {
    if (!selectedImageNode) return;
    if (e.target.closest('.image-resize-overlay') || e.target.closest('.image-resize-toolbar')) {
      return;
    }
    if (e.target === selectedImageNode || (e.target.tagName === 'IMG' && noteContentDiv?.contains(e.target))) {
      return;
    }
    deselectImage();
  });

  // Global keydown for Escape / Delete / Backspace
  window.addEventListener('keydown', (e) => {
    if (!selectedImageNode) return;
    if (e.key === 'Escape') {
      deselectImage();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      deleteSelectedImage();
    }
  });

  // Window resize/scroll keeps overlay attached to image
  window.addEventListener('resize', updateResizeOverlay);
  window.addEventListener('scroll', updateResizeOverlay, true);

  function insertImageIntoEditor(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (!dataUrl) return;

      if (noteContentDiv) {
        noteContentDiv.focus();
      }

      const sel = window.getSelection();
      let range = null;
      if (sel && sel.rangeCount > 0) {
        range = sel.getRangeAt(0);
        if (!noteContentDiv?.contains(range.commonAncestorContainer)) {
          range = document.createRange();
          range.selectNodeContents(noteContentDiv);
          range.collapse(false);
        }
      } else if (noteContentDiv) {
        range = document.createRange();
        range.selectNodeContents(noteContentDiv);
        range.collapse(false);
      }

      if (!range) return;

      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = file.name || 'Pasted image';
      img.className = 'retro-note-image';
      img.title = file.name || 'Pasted note image';

      range.deleteContents();
      range.insertNode(img);

      const spacer = document.createElement('div');
      spacer.innerHTML = '<br>';
      if (img.nextSibling) {
        img.parentNode.insertBefore(spacer, img.nextSibling);
      } else {
        img.parentNode.appendChild(spacer);
      }

      const newRange = document.createRange();
      newRange.setStart(spacer, 0);
      newRange.collapse(true);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(newRange);
      }

      triggerAutoSave();
      updateStats(noteContentDiv.innerText);

      // Auto-select newly inserted image
      setTimeout(() => {
        if (img && noteContentDiv?.contains(img)) {
          selectImage(img);
        }
      }, 50);
    };
    reader.readAsDataURL(file);
  }

  if (insertImageBtn && imageFileInput) {
    insertImageBtn.onclick = () => imageFileInput.click();
    imageFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) insertImageIntoEditor(file);
      e.target.value = '';
    };
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

  // 10. Plaintext, Word (.docx), and PDF Exports
  if (exportNoteBtn) {
    exportNoteBtn.onclick = () => {
      const title = noteTitleInput ? noteTitleInput.value : 'note';
      const rawHtml = noteContentDiv ? noteContentDiv.innerHTML : '';
      const sec = sections.find((s) => s.id === activeSectionId);

      let cleanBody = rawHtml;
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

      const text = `========================================\n` +
        `SECTION: ${sec ? sec.name : 'General'}\n` +
        `TITLE:   ${title || 'Untitled Note'}\n` +
        `DATE:    ${new Date().toLocaleString()}\n` +
        `========================================\n\n` + cleanBody;

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title || 'note').replace(/[^a-z0-9_-]/gi, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(a);
    };
  }

  // DOCX & PDF Export helpers
  function dataUrlToUint8Array(dataUrl) {
    const parts = dataUrl.split(',');
    const byteString = atob(parts[1]);
    const u8 = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      u8[i] = byteString.charCodeAt(i);
    }
    return u8;
  }

  async function prepareImageForDocx(src, naturalWidth, naturalHeight) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const origW = img.naturalWidth || naturalWidth || 400;
        const origH = img.naturalHeight || naturalHeight || 300;
        const maxDocxWidth = 520;
        let targetW = origW;
        let targetH = origH;
        if (targetW > maxDocxWidth) {
          targetH = Math.round((maxDocxWidth / targetW) * targetH);
          targetW = maxDocxWidth;
        }

        const isStandard = src.startsWith('data:image/png') || src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg');
        if (isStandard) {
          try {
            resolve({ data: dataUrlToUint8Array(src), width: targetW, height: targetH });
            return;
          } catch {}
        }

        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const pngUrl = canvas.toDataURL('image/png');
          resolve({ data: dataUrlToUint8Array(pngUrl), width: targetW, height: targetH });
        } catch {
          try {
            resolve({ data: dataUrlToUint8Array(src), width: targetW, height: targetH });
          } catch {
            resolve(null);
          }
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function generateDocxBlob(title, contentHtml, sectionName) {
    if (!window.docx) throw new Error('docx library not loaded');
    const { Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, HeadingLevel, AlignmentType, UnderlineType, BorderStyle } = window.docx;

    const parser = new DOMParser();
    const docParsed = parser.parseFromString(`<body>${contentHtml || ''}</body>`, 'text/html');
    const body = docParsed.body;

    const paragraphs = [];

    async function parseInlineNodes(node, context = {}) {
      const inlines = [];
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent;
          if (text) {
            inlines.push(
              new TextRun({
                text,
                bold: Boolean(context.bold),
                italics: Boolean(context.italics),
                underline: context.underline ? { type: UnderlineType.SINGLE } : undefined,
                strike: Boolean(context.strike),
                font: context.font || 'Georgia',
                size: context.size || 22,
                color: context.color || '1a1714',
              })
            );
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase();
          if (tag === 'br') {
            inlines.push(new TextRun({ break: 1 }));
          } else if (tag === 'b' || tag === 'strong') {
            inlines.push(...(await parseInlineNodes(child, { ...context, bold: true })));
          } else if (tag === 'i' || tag === 'em') {
            inlines.push(...(await parseInlineNodes(child, { ...context, italics: true })));
          } else if (tag === 'u') {
            inlines.push(...(await parseInlineNodes(child, { ...context, underline: true })));
          } else if (tag === 's' || tag === 'strike' || tag === 'del') {
            inlines.push(...(await parseInlineNodes(child, { ...context, strike: true })));
          } else if (tag === 'code') {
            inlines.push(...(await parseInlineNodes(child, { ...context, font: 'Courier New', size: 20 })));
          } else if (tag === 'a') {
            const href = child.getAttribute('href') || '#';
            const linkChildren = await parseInlineNodes(child, { ...context, color: '0000cc', underline: true });
            inlines.push(
              new ExternalHyperlink({
                children: linkChildren.length > 0 ? linkChildren : [
                  new TextRun({
                    text: child.innerText || href,
                    style: 'Hyperlink',
                    color: '0000cc',
                    underline: { type: UnderlineType.SINGLE },
                    font: 'Georgia',
                  }),
                ],
                link: href,
              })
            );
          } else if (tag === 'img') {
            const src = child.getAttribute('src');
            if (src) {
              const imgData = await prepareImageForDocx(src, child.naturalWidth || child.width, child.naturalHeight || child.height);
              if (imgData) {
                inlines.push(
                  new ImageRun({
                    data: imgData.data,
                    transformation: { width: imgData.width, height: imgData.height },
                  })
                );
              }
            }
          } else {
            inlines.push(...(await parseInlineNodes(child, context)));
          }
        }
      }
      return inlines;
    }

    async function processBlock(node) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'ul') {
        const items = Array.from(node.children).filter((c) => c.tagName && c.tagName.toLowerCase() === 'li');
        for (const li of items) {
          const inlines = await parseInlineNodes(li);
          paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: inlines.length > 0 ? inlines : [new TextRun('')], spacing: { before: 40, after: 60, line: 320 } }));
        }
        return;
      }
      if (tag === 'ol') {
        const items = Array.from(node.children).filter((c) => c.tagName && c.tagName.toLowerCase() === 'li');
        let idx = 1;
        for (const li of items) {
          const inlines = await parseInlineNodes(li);
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `${idx}.  `, bold: true, font: 'Georgia', size: 22 }), ...inlines],
            indent: { left: 400 },
            spacing: { before: 40, after: 60, line: 320 }
          }));
          idx++;
        }
        return;
      }
      if (tag === 'blockquote') {
        const inlines = await parseInlineNodes(node, { italics: true });
        paragraphs.push(new Paragraph({
          children: inlines,
          indent: { left: 720 },
          spacing: { before: 100, after: 100, line: 320 },
          border: { left: { color: '8e8065', space: 10, style: BorderStyle.SINGLE, size: 12 } }
        }));
        return;
      }
      if (tag === 'hr') {
        paragraphs.push(new Paragraph({ children: [], border: { bottom: { color: '9f9175', space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { before: 120, after: 120 } }));
        return;
      }
      if (tag === 'img') {
        const src = node.getAttribute('src');
        if (src) {
          const imgData = await prepareImageForDocx(src, node.naturalWidth || node.width, node.naturalHeight || node.height);
          if (imgData) {
            paragraphs.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: imgData.data, transformation: { width: imgData.width, height: imgData.height } })],
              spacing: { before: 140, after: 140 }
            }));
          }
        }
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const sizes = { 1: 36, 2: 30, 3: 26, 4: 24, 5: 22, 6: 20 };
        const inlines = await parseInlineNodes(node, { bold: true, size: sizes[level] || 24 });
        paragraphs.push(new Paragraph({
          heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          children: inlines,
          spacing: { before: 200, after: 100 }
        }));
        return;
      }
      const inlines = await parseInlineNodes(node);
      paragraphs.push(new Paragraph({
        children: inlines.length > 0 ? inlines : [new TextRun('')],
        spacing: { before: 60, after: 80, line: 340 }
      }));
    }

    const children = Array.from(body.childNodes);
    let pending = [];
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent;
        if (t && t.trim().length > 0) {
          pending.push(new TextRun({ text: t, font: 'Georgia', size: 22, color: '1a1714' }));
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        const isBlock = ['p', 'div', 'ul', 'ol', 'blockquote', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
        if (isBlock) {
          if (pending.length > 0) {
            paragraphs.push(new Paragraph({ children: pending, spacing: { before: 60, after: 80, line: 340 } }));
            pending = [];
          }
          await processBlock(child);
        } else {
          pending.push(...(await parseInlineNodes(child)));
        }
      }
    }
    if (pending.length > 0) {
      paragraphs.push(new Paragraph({ children: pending, spacing: { before: 60, after: 80, line: 340 } }));
    }

    const dateString = new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const headerParas = [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: 'THE ELECTRONIC NOTEPAD (GO EDITION)', font: 'Courier New', size: 18, bold: true, color: '6f644f', characterSpacing: 40 })],
        spacing: { before: 0, after: 40 }
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: `SECTION: ${(sectionName || 'General').toUpperCase()}   •   DATE: ${dateString}`, font: 'Courier New', size: 18, color: '706b60' })],
        spacing: { before: 0, after: 120 },
        border: { bottom: { color: '9f9175', space: 6, style: BorderStyle.SINGLE, size: 8 } }
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: title || 'Untitled Note', font: 'Georgia', size: 40, bold: true, color: '1a1612' })],
        spacing: { before: 200, after: 160 },
        border: { bottom: { color: 'b5a98e', space: 6, style: BorderStyle.SINGLE, size: 6 } }
      }),
    ];

    const footerParas = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '— End of Ledger Note —', font: 'Courier New', size: 16, italics: true, color: '9f9684' })],
        spacing: { before: 400, after: 100 },
        border: { top: { color: 'dcd1b3', space: 6, style: BorderStyle.DASHED, size: 6 } }
      })
    ];

    const documentInstance = new Document({
      sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [...headerParas, ...paragraphs, ...footerParas]
      }]
    });

    return await Packer.toBlob(documentInstance);
  }

  async function generatePdf(title, contentHtml, sectionName) {
    const jsPDFConstructor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFConstructor || !window.html2canvas) {
      throw new Error('PDF export libraries not loaded');
    }

    const dateString = new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

    const stage = document.createElement('div');
    stage.style.position = 'fixed';
    stage.style.left = '-9999px';
    stage.style.top = '0';
    stage.style.width = '794px';
    stage.style.backgroundColor = '#ffffff';
    stage.style.color = '#1a1612';
    stage.style.fontFamily = 'Georgia, "Times New Roman", Times, serif';
    stage.style.fontSize = '14px';
    stage.style.lineHeight = '1.8';
    stage.style.padding = '48px 56px';
    stage.style.boxSizing = 'border-box';
    stage.style.zIndex = '-1000';

    stage.innerHTML = `
      <div style="border-bottom: 2px solid #6f644f; padding-bottom: 8px; margin-bottom: 20px; font-family: 'Courier New', Courier, monospace;">
        <div style="font-size: 11px; font-weight: bold; letter-spacing: 2px; color: #8c2b2b; text-transform: uppercase;">
          THE ELECTRONIC NOTEPAD • DESK LEDGER
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #554d3f; margin-top: 4px;">
          <span><strong>FOLDER:</strong> ${sectionName || 'General'}</span>
          <span><strong>DATE:</strong> ${dateString}</span>
        </div>
      </div>
      <div style="border-bottom: 2px solid #1a1612; padding-bottom: 10px; margin-bottom: 24px;">
        <h1 style="font-size: 26px; font-weight: bold; margin: 0; color: #1a1612; font-family: Georgia, serif; line-height: 1.3;">
          ${title || 'Untitled Note'}
        </h1>
      </div>
      <div id="pdf-body-content" style="font-size: 14px; line-height: 28px; word-break: break-word; color: #1a1714;">
        ${contentHtml || '<p style="color: #888; font-style: italic;">(Empty note)</p>'}
      </div>
      <div style="margin-top: 40px; padding-top: 12px; border-top: 1px dashed #b5a98e; font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #8c8270; text-align: center;">
        — Preserved from Go + NeonDB Desk Ledger —
      </div>
    `;

    const styleTag = document.createElement('style');
    styleTag.textContent = `
      #pdf-body-content a { color: #0000cc !important; text-decoration: underline !important; font-weight: 600; }
      #pdf-body-content img { max-width: 100% !important; height: auto !important; display: block; margin: 16px auto; border: 1px solid #8e8065; box-shadow: 2px 3px 6px rgba(0,0,0,0.15); border-radius: 2px; }
      #pdf-body-content ul, #pdf-body-content ol { margin: 12px 0 12px 24px; padding-left: 12px; }
      #pdf-body-content li { margin-bottom: 6px; }
      #pdf-body-content blockquote { border-left: 3px solid #8e8065; padding-left: 12px; margin: 12px 0; color: #554d3f; font-style: italic; }
    `;
    stage.appendChild(styleTag);
    document.body.appendChild(stage);

    try {
      const images = Array.from(stage.querySelectorAll('img'));
      await Promise.all(images.map((img) => new Promise((resolve) => {
        if (img.complete) resolve();
        else { img.onload = resolve; img.onerror = resolve; }
      })));

      const canvas = await window.html2canvas(stage, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 794,
      });

      const pdf = new jsPDFConstructor('p', 'mm', 'a4');
      const pdfWidth = 210;
      const pdfHeight = 297;
      const margin = 10;
      const printableWidth = pdfWidth - margin * 2;
      const printableHeight = pdfHeight - margin * 2;

      const imgWidthPx = canvas.width;
      const imgHeightPx = canvas.height;
      const pageHeightPx = Math.floor((printableHeight / printableWidth) * imgWidthPx);

      let renderedHeight = 0;
      let pageIndex = 0;

      while (renderedHeight < imgHeightPx) {
        if (pageIndex > 0) pdf.addPage();
        const chunkHeight = Math.min(pageHeightPx, imgHeightPx - renderedHeight);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = imgWidthPx;
        pageCanvas.height = chunkHeight;
        const pageCtx = pageCanvas.getContext('2d');
        pageCtx.drawImage(canvas, 0, renderedHeight, imgWidthPx, chunkHeight, 0, 0, imgWidthPx, chunkHeight);

        const pageImgData = pageCanvas.toDataURL('image/png');
        const renderedHeightMm = (chunkHeight / imgWidthPx) * printableWidth;
        pdf.addImage(pageImgData, 'PNG', margin, margin, printableWidth, renderedHeightMm);

        renderedHeight += chunkHeight;
        pageIndex++;
      }

      pdf.save(`${(title || 'note').replace(/[^a-z0-9_-]/gi, '_')}.pdf`);
    } finally {
      document.body.removeChild(stage);
    }
  }

  if (exportDocxBtn) {
    exportDocxBtn.onclick = async () => {
      const title = noteTitleInput ? noteTitleInput.value : 'note';
      const rawHtml = noteContentDiv ? noteContentDiv.innerHTML : '';
      const sec = sections.find((s) => s.id === activeSectionId);
      exportDocxBtn.textContent = '⏳ Exporting...';
      try {
        const blob = await generateDocxBlob(title, rawHtml, sec ? sec.name : 'General');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(title || 'note').replace(/[^a-z0-9_-]/gi, '_')}.docx`;
        a.click();
        URL.revokeObjectURL(a);
      } catch (err) {
        console.error('Failed to export DOCX:', err);
        alert('Could not export Word document. Please try again.');
      } finally {
        exportDocxBtn.textContent = '📄 Export .docx';
      }
    };
  }

  if (exportPdfBtn) {
    exportPdfBtn.onclick = async () => {
      const title = noteTitleInput ? noteTitleInput.value : 'note';
      const rawHtml = noteContentDiv ? noteContentDiv.innerHTML : '';
      const sec = sections.find((s) => s.id === activeSectionId);
      exportPdfBtn.textContent = '⏳ Exporting...';
      try {
        await generatePdf(title, rawHtml, sec ? sec.name : 'General');
      } catch (err) {
        console.error('Failed to export PDF:', err);
        alert('Could not export PDF document. Please try again.');
      } finally {
        exportPdfBtn.textContent = '📑 Export .pdf';
      }
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
