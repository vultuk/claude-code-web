class ClaudePane {
  constructor(index, app) {
    this.index = index;
    this.app = app; // reference to main app for auth and session list
    this.terminal = null;
    this.fitAddon = null;
    this.webLinksAddon = null;
    this.socket = null;
    this.sessionId = null;
    this.container = document.getElementById(`tileTerminal${index}`);
    this.hadOutput = false;
    this.startOverlayEl = null;
  }

  async setSession(sessionId) {
    if (this.sessionId === sessionId) return;
    this.disconnect();
    this.sessionId = sessionId;
    if (!sessionId) return;
    this.ensureTerminal();
    await this.connect();
    // If newly attached and no output yet, show per-pane start overlay
    setTimeout(() => {
      if (!this.hadOutput) this.showStartOverlay();
    }, 50);
  }

  ensureTerminal() {
    if (this.terminal) return;
    this.terminal = new Terminal({
      fontFamily: this.app?.terminal?.options?.fontFamily || "JetBrains Mono, monospace",
      fontSize: this.app?.terminal?.options?.fontSize || 14,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      theme: this.app?.terminal?.options?.theme
    });
    this.fitAddon = new FitAddon.FitAddon();
    this.webLinksAddon = new WebLinksAddon.WebLinksAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.webLinksAddon);
    this.terminal.open(this.container);
    this.fit();
    window.addEventListener('resize', () => this.fit());
  }

  fit() {
    try { this.fitAddon?.fit(); } catch (_) {}
  }

  async connect() {
    if (!this.sessionId) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${location.host}`;
    wsUrl += `?sessionId=${encodeURIComponent(this.sessionId)}`;
    wsUrl = window.authManager.getWebSocketUrl(wsUrl);
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      // size sync
      const { cols, rows } = this.terminal;
      this.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      this.terminal.focus();
    };
    this.socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        const filtered = msg.data.replace(/\x1b\[\[?[IO]/g, '');
        this.terminal.write(filtered);
        if (filtered) {
          this.hadOutput = true;
          this.hideStartOverlay();
        }
      }
    };
    this.socket.onclose = () => {};
    this.socket.onerror = () => {};

    this.terminal.onData((data) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        const filtered = data.replace(/\x1b\[\[?[IO]/g, '');
        if (filtered) this.socket.send(JSON.stringify({ type: 'input', data: filtered }));
      }
    });
    this.terminal.onResize(({ cols, rows }) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
  }

  disconnect() {
    try { this.socket?.close(); } catch (_) {}
    this.socket = null;
    try { this.terminal?.clear(); } catch (_) {}
    this.hadOutput = false;
    this.hideStartOverlay();
  }

  showStartOverlay() {
    // Build a minimal per-pane start overlay (Claude/Codex)
    if (!this.container) return;
    this.hideStartOverlay();
    const ov = document.createElement('div');
    ov.className = 'pane-start-overlay';
    ov.innerHTML = `
      <div class="pane-start-card">
        <h3>Select Assistant</h3>
        <p>Start an assistant in this session.</p>
        <div class="pane-start-actions">
          <button class="btn btn-primary" data-kind="claude">Start ${this.app?.getAlias?.('claude') || 'Claude'}</button>
          <button class="btn btn-danger" data-kind="claude" data-danger>Dangerous ${this.app?.getAlias?.('claude') || 'Claude'}</button>
          <button class="btn btn-primary" data-kind="codex">Start ${this.app?.getAlias?.('codex') || 'Codex'}</button>
          <button class="btn btn-danger" data-kind="codex" data-danger>Dangerous ${this.app?.getAlias?.('codex') || 'Codex'}</button>
        </div>
      </div>`;
    ov.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.getAttribute('data-kind');
        const dangerous = btn.hasAttribute('data-danger');
        this.startAssistant(kind, { dangerouslySkipPermissions: dangerous });
      });
    });
    this.container.appendChild(ov);
    this.startOverlayEl = ov;
  }

  hideStartOverlay() {
    if (this.startOverlayEl && this.startOverlayEl.parentNode) {
      this.startOverlayEl.remove();
      this.startOverlayEl = null;
    }
  }

  startAssistant(kind = 'claude', options = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const type = kind === 'codex' ? 'start_codex' : 'start_claude';
    this.socket.send(JSON.stringify({ type, options }));
    this.hideStartOverlay();
  }
}

class PaneManager {
  constructor(app) {
    this.app = app;
    this.enabled = false;
    this.grid = document.getElementById('tileGrid');
    this.container = document.getElementById('tilesContainer');
    // Initialize panes from DOM
    this.panes = [];
    this.widths = []; // percentages per pane
    this.tabs = [];   // per-pane tabs: [{list:[sessionId], active: sessionId}]
    this.maxPanes = 4;
    this.activeIndex = 0;
    this.initFromDom();
    this.restoreFromStorage();
    this.bindUI();

    // Grid-level drag to create a new split on right edge
    this.grid.addEventListener('dragover', (e) => {
      const sid = e.dataTransfer?.getData('application/x-session-id');
      if (!sid) return;
      e.preventDefault();
    });
    this.grid.addEventListener('drop', (e) => {
      const sid = e.dataTransfer?.getData('application/x-session-id');
      if (!sid) return;
      const rect = this.grid.getBoundingClientRect();
      const nearRight = (e.clientX > rect.right - 60);
      if (nearRight && this.panes.length < this.maxPanes) {
        const sourcePane = parseInt(e.dataTransfer.getData('x-source-pane') || '-1', 10);
        this.addPane(true);
        const newIndex = this.panes.length - 1;
        this.assignSession(newIndex, sid);
        if (!isNaN(sourcePane) && sourcePane >= 0) this.removeTabFromPane(sourcePane, sid);
        e.preventDefault();
      }
    });
  }

  initFromDom() {
    const paneEls = Array.from(this.grid.querySelectorAll('.tile-pane'));
    this.panes = paneEls.map((el, i) => {
      // focus handlers and DnD for initial panes
      this.bindPaneDnd(el, i);
      el.addEventListener('mousedown', () => this.focusPane(i));
      el.querySelector('.tile-toolbar')?.addEventListener('mousedown', () => this.focusPane(i));
      return new ClaudePane(i, this.app);
    });
    const count = this.panes.length || 2;
    this.widths = Array(count).fill(100 / count);
    this.tabs = Array(count).fill(0).map(() => ({ list: [], active: null }));
    this.applySplit();
    // Render empty tab bars
    this.panes.forEach((_, i) => this.renderPaneTabs(i));
  }

  bindUI() {
    // Setup resizers
    this.grid.querySelectorAll('.resizer').forEach((rz, index) => {
      this.bindResizer(rz, index);
    });
    document.querySelectorAll('.tile-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        this.removePane(idx);
      });
    });
    // Populate selects and handle change
    this.refreshSessionSelects();
    document.querySelectorAll('.tile-session-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(sel.dataset.index, 10);
        const id = e.target.value || null;
        this.assignSession(idx, id);
      });
    });
  }

  enable() {
    this.enabled = true;
    const tc = document.getElementById('terminalContainer');
    if (tc) {
      tc.style.display = '';
      const tw = tc.querySelector('.terminal-wrapper');
      if (tw) tw.style.display = 'none';
    }
    this.container.style.display = 'flex';
    this.applySplit();
    // Default: left pane uses current active session
    const active = this.app?.currentClaudeSessionId;
    if (active) this.assignSession(0, active);
    this.focusPane(this.activeIndex || 0);
    // Hide global tabs in tiled mode
    const tabsSection = document.querySelector('.tabs-section');
    if (tabsSection) tabsSection.style.display = 'none';
    const overflow = document.getElementById('tabOverflowWrapper');
    if (overflow) overflow.style.display = 'none';
    this.persist();
  }
  disable() {
    this.enabled = false;
    this.container.style.display = 'none';
    const tc = document.getElementById('terminalContainer');
    if (tc) {
      tc.style.display = '';
      const tw = tc.querySelector('.terminal-wrapper');
      if (tw) tw.style.display = '';
    }
    // Show global tabs again
    const tabsSection = document.querySelector('.tabs-section');
    if (tabsSection) tabsSection.style.display = '';
    const overflow = document.getElementById('tabOverflowWrapper');
    if (overflow) overflow.style.display = '';
    this.persist();
  }

  applySplit() {
    // Build columns: width% + 6px between panes
    const cols = [];
    this.widths.forEach((w, i) => {
      cols.push(`${w}%`);
      if (i < this.widths.length - 1) cols.push('6px');
    });
    this.grid.style.gridTemplateColumns = cols.join(' ');
    this.panes.forEach(p => p.fit());
  }

  refreshSessionSelects() {
    let sessions = (this.app?.claudeSessions) || [];
    // Fallback to SessionTabManager if app.claudeSessions is not kept up to date
    if ((!sessions || sessions.length === 0) && this.app?.sessionTabManager?.activeSessions) {
      sessions = Array.from(this.app.sessionTabManager.activeSessions.values()).map(s => ({ id: s.id, name: s.name }));
    }
    document.querySelectorAll('.tile-session-select').forEach(sel => {
      const current = sel.value;
      sel.innerHTML = `<option value="">Select session…</option>` + sessions.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      if (current) sel.value = current;
    });
  }

  assignSession(index, sessionId) {
    const sel = document.querySelector(`.tile-session-select[data-index="${index}"]`);
    if (sel && sel.value !== sessionId) sel.value = sessionId || '';
    // Update pane tabs
    const state = this.tabs[index] || (this.tabs[index] = { list: [], active: null });
    if (!state.list.includes(sessionId)) state.list.push(sessionId);
    state.active = sessionId;
    this.renderPaneTabs(index);
    this.panes[index].setSession(sessionId);
    this.persist();
  }

  clearPane(index) {
    this.panes[index].setSession(null);
    this.tabs[index] = { list: [], active: null };
    this.renderPaneTabs(index);
    const sel = document.querySelector(`.tile-session-select[data-index="${index}"]`);
    if (sel) sel.value = '';
    this.persist();
  }

  persist() {
    try {
      const state = {
        enabled: this.enabled,
        widths: this.widths,
        tabs: this.tabs
      };
      localStorage.setItem('cc-web-tiles', JSON.stringify(state));
    } catch (_) {}
  }

  restoreFromStorage() {
    try {
      const raw = localStorage.getItem('cc-web-tiles');
      if (!raw) return;
      const st = JSON.parse(raw);
      if (Array.isArray(st.widths) && st.widths.length >= 2) this.widths = st.widths;
      if (st.enabled) {
        setTimeout(() => this.enable(), 0);
        // Ensure pane count matches saved sessions (limit to max)
        const needed = Math.min(this.maxPanes, Math.max(2, (st.tabs || []).length));
        while (this.panes.length < needed) this.addPane(false);
        this.applySplit();
        // rebuild pane tabs after sessions list loads
        setTimeout(() => {
          this.tabs = (st.tabs || []).map(t => ({ list: Array.isArray(t.list) ? t.list : [], active: t.active || null }));
          // ensure arrays for all panes
          while (this.tabs.length < this.panes.length) this.tabs.push({ list: [], active: null });
          this.tabs.forEach((t, i) => {
            this.renderPaneTabs(i);
            if (t.active) this.panes[i].setSession(t.active);
          });
        }, 500);
      }
    } catch (_) {}
  }

  addPane(persist = true) {
    if (this.panes.length >= this.maxPanes) return;
    const index = this.panes.length;
    // Insert resizer
    const rz = document.createElement('div');
    rz.className = 'resizer';
    rz.dataset.index = String(index - 1);
    this.grid.appendChild(rz);
    this.bindResizer(rz, index - 1);
    // Insert pane
    const pane = document.createElement('div');
    pane.className = 'tile-pane';
    pane.dataset.index = String(index);
    pane.innerHTML = `
      <div class="tile-toolbar">
        <select class="tile-session-select" data-index="${index}"></select>
        <div class="spacer"></div>
        <button class="tile-close" data-index="${index}" title="Close Pane">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="tile-terminal" id="tileTerminal${index}"></div>
    `;
    this.grid.appendChild(pane);
    const cp = new ClaudePane(index, this.app);
    this.panes.push(cp);
    // Recompute widths equally
    const n = this.panes.length;
    this.widths = Array(n).fill(100 / n);
    this.applySplit();
    this.refreshSessionSelects();
    // Drag & drop listeners for pane
    this.bindPaneDnd(pane, index);
    pane.addEventListener('mousedown', () => this.focusPane(index));
    pane.querySelector('.tile-toolbar')?.addEventListener('mousedown', () => this.focusPane(index));
    // init pane tabs state
    this.tabs[index] = this.tabs[index] || { list: [], active: null };
    this.renderPaneTabs(index);
    if (persist) this.persist();
  }

  bindResizer(rz, leftIndex) {
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    let startRight = 0;
    const onDown = (e) => {
      dragging = true;
      startX = (e.touches ? e.touches[0].clientX : e.clientX);
      startLeft = this.widths[leftIndex];
      startRight = this.widths[leftIndex + 1];
      document.body.style.userSelect = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      const rect = this.grid.getBoundingClientRect();
      const deltaPct = ((x - startX) / rect.width) * 100;
      let newLeft = Math.max(10, Math.min(90, startLeft + deltaPct));
      let newRight = startLeft + startRight - newLeft;
      if (newRight < 10) { newRight = 10; newLeft = startLeft + startRight - 10; }
      this.widths[leftIndex] = newLeft;
      this.widths[leftIndex + 1] = newRight;
      this.applySplit();
    };
    const onUp = () => { dragging = false; document.body.style.userSelect = ''; this.persist(); };
    rz.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    rz.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp, { passive: true });
  }

  bindPaneDnd(paneEl, index) {
    paneEl.addEventListener('dragover', (e) => { e.preventDefault(); paneEl.classList.add('drag-over'); });
    paneEl.addEventListener('dragleave', () => paneEl.classList.remove('drag-over'));
    paneEl.addEventListener('drop', (e) => {
      e.preventDefault(); paneEl.classList.remove('drag-over');
      let sid = e.dataTransfer.getData('application/x-session-id') || e.dataTransfer.getData('text/plain');
      if (!sid) {
        const dragging = document.querySelector('.tabs-container .session-tab.dragging');
        sid = dragging?.dataset?.sessionId || '';
      }
      if (sid) {
        const sourcePane = parseInt(e.dataTransfer.getData('x-source-pane') || '-1', 10);
        this.assignSession(index, sid);
        if (!isNaN(sourcePane) && sourcePane >= 0 && sourcePane !== index) this.removeTabFromPane(sourcePane, sid);
      }
    });
  }

  focusPane(index) {
    this.activeIndex = index;
    Array.from(this.grid.querySelectorAll('.tile-pane')).forEach((el, i) => {
      if (i === index) el.classList.add('active'); else el.classList.remove('active');
    });
  }

  renderPaneTabs(index) {
    const holder = this.grid.querySelector(`.pane-tabs[data-index="${index}"]`);
    const addBtn = this.grid.querySelector(`.pane-add[data-index="${index}"]`);
    const sel = this.grid.querySelector(`.tile-session-select[data-index="${index}"]`);
    if (!holder) return;
    const state = this.tabs[index] || { list: [], active: null };
    holder.innerHTML = '';
    state.list.forEach((sid) => {
      const s = (this.app?.claudeSessions || []).find(x => x.id === sid) || this.app?.sessionTabManager?.activeSessions?.get(sid);
      const name = s?.name || (sid.slice(0, 6) + '…');
      const el = document.createElement('div');
      el.className = 'pane-tab' + (state.active === sid ? ' active' : '');
      el.title = s?.workingDir || name;
      el.innerHTML = `<span class="name">${name}</span><span class="close" title="Close">×</span>`;
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-session-id', sid);
        e.dataTransfer.setData('text/plain', sid);
        e.dataTransfer.setData('x-source-pane', String(index));
      });
      // activate
      el.addEventListener('click', (e) => {
        if ((e.target).classList.contains('close')) return;
        state.active = sid;
        this.panes[index].setSession(sid);
        this.persist();
        this.renderPaneTabs(index);
      });
      // close
      el.querySelector('.close').addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.list.indexOf(sid);
        if (idx >= 0) state.list.splice(idx, 1);
        if (state.active === sid) {
          state.active = state.list[idx] || state.list[idx - 1] || state.list[0] || null;
          this.panes[index].setSession(state.active || null);
        }
        this.persist();
        this.renderPaneTabs(index);
      });
      holder.appendChild(el);
    });
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.stopPropagation();
        this.openAddMenu(index, addBtn);
      };
    }
  }

  removePane(index) {
    if (this.panes.length <= 1) {
      // Always keep at least one pane; just clear it
      this.clearPane(index);
      return;
    }
    // Close socket/terminal
    try { this.panes[index]?.disconnect(); } catch (_) {}
    // Remove state
    const removedWidth = this.widths[index] || 0;
    this.panes.splice(index, 1);
    this.tabs.splice(index, 1);
    // Re-normalize widths
    const remain = 100 - removedWidth;
    this.widths = this.widths.filter((_, i) => i !== index).map(w => (w * 100) / (remain || 100));
    // Rebuild DOM grid cleanly
    this.rebuildGrid();
    this.persist();
  }

  rebuildGrid() {
    // Clear
    this.grid.innerHTML = '';
    // Recreate panes + resizers
    const count = this.panes.length;
    const oldTabs = this.tabs.map(t => ({ list: [...t.list], active: t.active }));
    this.panes = [];
    for (let i = 0; i < count; i++) {
      // Pane
      const pane = document.createElement('div');
      pane.className = 'tile-pane';
      pane.dataset.index = String(i);
      pane.innerHTML = `
        <div class="tile-toolbar">
          <div class="pane-tabs" data-index="${i}"></div>
          <button class="pane-add" data-index="${i}" title="Add tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <select class="tile-session-select" data-index="${i}" style="display:none"></select>
          <div class="spacer"></div>
          <button class="tile-close" data-index="${i}" title="Close Pane">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="tile-terminal" id="tileTerminal${i}"></div>`;
      this.grid.appendChild(pane);
      // Add resizer except after last pane
      if (i < count - 1) {
        const rz = document.createElement('div');
        rz.className = 'resizer';
        rz.dataset.index = String(i);
        this.grid.appendChild(rz);
      }
      const cp = new ClaudePane(i, this.app);
      this.panes.push(cp);
      this.bindPaneDnd(pane, i);
      pane.addEventListener('mousedown', () => this.focusPane(i));
      pane.querySelector('.tile-toolbar')?.addEventListener('mousedown', () => this.focusPane(i));
    }
    // Bind resizers and close buttons again
    this.grid.querySelectorAll('.resizer').forEach((rz, idx) => this.bindResizer(rz, idx));
    this.grid.querySelectorAll('.tile-close').forEach(btn => btn.addEventListener('click', () => this.removePane(parseInt(btn.dataset.index, 10))));
    this.grid.querySelectorAll('.pane-add').forEach(btn => btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.dataset.index, 10);
      this.openAddMenu(idx, btn);
      e.stopPropagation();
    }));
    // Refresh selects and tabs
    this.refreshSessionSelects();
    this.tabs = oldTabs;
    for (let i = 0; i < this.tabs.length; i++) this.renderPaneTabs(i);
    // Apply sizes
    this.applySplit();
  }

  removeTabFromPane(index, sid) {
    const state = this.tabs[index];
    if (!state) return;
    const idx = state.list.indexOf(sid);
    if (idx >= 0) state.list.splice(idx, 1);
    if (state.active === sid) {
      state.active = state.list[idx] || state.list[idx - 1] || state.list[0] || null;
      this.panes[index].setSession(state.active || null);
    }
    this.renderPaneTabs(index);
    this.persist();
  }

  openAddMenu(index, anchorEl) {
    // Remove any existing menu
    document.querySelectorAll('.pane-session-menu').forEach(m => m.remove());
    // Build list of sessions
    let sessions = (this.app?.claudeSessions) || [];
    if ((!sessions || sessions.length === 0) && this.app?.sessionTabManager?.activeSessions) {
      sessions = Array.from(this.app.sessionTabManager.activeSessions.values());
    }
    const menu = document.createElement('div');
    menu.className = 'pane-session-menu';
    if (!sessions || sessions.length === 0) {
      menu.innerHTML = `<div class="pane-session-empty">No sessions available</div>
                        <div class="pane-session-action">Create New Session…</div>`;
      menu.querySelector('.pane-session-action').onclick = () => {
        document.body.click(); // close
        this.app?.showFolderBrowser?.();
      };
    } else {
      const used = new Set((this.tabs[index]?.list) || []);
      // Show available sessions (include also ones already used so you can add duplicates if desired)
      const items = sessions.map(s => {
        const el = document.createElement('div');
        el.className = 'pane-session-item' + (used.has(s.id) ? ' used' : '');
        const name = s.name || s.id.slice(0,6)+'…';
        el.textContent = name;
        el.title = s.workingDir || name;
        el.onclick = () => {
          this.assignSession(index, s.id);
          document.body.click();
        };
        return el;
      });
      items.forEach(el => menu.appendChild(el));
      const sep = document.createElement('div'); sep.className='pane-session-sep'; menu.appendChild(sep);
      const createEl = document.createElement('div'); createEl.className='pane-session-action'; createEl.textContent = 'Create New Session…';
      createEl.onclick = () => { document.body.click(); this.app?.showFolderBrowser?.(); };
      menu.appendChild(createEl);
    }
    document.body.appendChild(menu);
    // Position near anchor
    const r = anchorEl.getBoundingClientRect();
    const top = r.bottom + window.scrollY + 6;
    const left = r.left + window.scrollX;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    // Close on outside click or Escape
    const close = (ev) => {
      if (ev.type === 'keydown' && ev.key !== 'Escape') return;
      if (ev.type === 'click' && menu.contains(ev.target)) return;
      menu.remove();
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', close, true);
    };
    setTimeout(() => {
      document.addEventListener('click', close, true);
      document.addEventListener('keydown', close, true);
    }, 0);
  }
}

window.PaneManager = PaneManager;
