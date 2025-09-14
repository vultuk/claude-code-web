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
    // If likely already running, do not show the overlay
    if (this.isLikelyRunning()) {
      this.hadOutput = true;
      this.hideStartOverlay();
      return;
    }
    // Otherwise, show overlay after a short delay if no output arrives
    setTimeout(() => {
      if (!this.hadOutput && !this.isLikelyRunning()) this.showStartOverlay();
    }, 600);
  }

  ensureTerminal() {
    if (this.terminal) return;
    // Refresh container in case grid was rebuilt
    this.container = document.getElementById(`tileTerminal${this.index}`);
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
      } else if (msg.type === 'session_joined') {
        // Replay recent buffer so existing sessions show content immediately
        if (Array.isArray(msg.outputBuffer) && msg.outputBuffer.length) {
          const joined = msg.outputBuffer.join('');
          const filtered = joined.replace(/\x1b\[\[?[IO]/g, '');
          this.terminal.write(filtered);
          if (filtered) {
            this.hadOutput = true;
            this.hideStartOverlay();
          }
        }
      } else if (msg.type === 'error') {
        // Show errors in terminal UI for visibility
        const text = (msg.message || 'Error').toString();
        this.terminal.write(`\r\n\x1b[31m${text}\x1b[0m\r\n`);
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

  isLikelyRunning() {
    try {
      const id = this.sessionId;
      if (!id) return false;
      // Check live sessions list from server
      const list = this.app?.claudeSessions || [];
      const s = list.find(x => x.id === id);
      if (s && s.active) return true;
      // Check tab manager status if present
      const sm = this.app?.sessionTabManager;
      if (sm && sm.activeSessions) {
        const rec = sm.activeSessions.get(id);
        // Consider only 'active' as running. 'idle' may mean newly created and never started.
        if (rec && rec.status === 'active') return true;
      }
    } catch (_) {}
    return false;
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
    this.widths = []; // percentages per column
    this.heights = [100]; // percentages per row
    this.rows = 1;
    this.cols = 1;
    this.tabs = [];   // per-pane tabs: [{list:[sessionId], active: sessionId}]
    this.maxPanes = 4; // total cells (rows*cols) limit
    this.activeIndex = 0;
    this.initFromDom();
    this.restoreFromStorage();
    this.bindUI();

    // Grid-level drag to create a new split near edges
    this.grid.addEventListener('dragover', (e) => {
      const sid = e.dataTransfer?.getData('application/x-session-id');
      if (!sid) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = (e.ctrlKey || e.metaKey) ? 'copy' : 'move';
    });
    this.grid.addEventListener('drop', (e) => {
      const sid = e.dataTransfer?.getData('application/x-session-id');
      if (!sid) return;
      const rect = this.grid.getBoundingClientRect();
      const nearLeft = (e.clientX < rect.left + 60);
      const nearRight = (e.clientX > rect.right - 60);
      const nearTop = (e.clientY < rect.top + 60);
      const nearBottom = (e.clientY > rect.bottom - 60);
      const sourcePane = parseInt(e.dataTransfer.getData('x-source-pane') || '-1', 10);
      const copy = !!(e.ctrlKey || e.metaKey);

      if ((nearLeft || nearRight || nearTop || nearBottom)) {
        if (nearLeft) {
          this.splitEdge('left', sid, copy, sourcePane);
          e.preventDefault();
        } else if (nearRight) {
          this.splitEdge('right', sid, copy, sourcePane);
          e.preventDefault();
        } else if (nearTop) {
          this.splitEdge('top', sid, copy, sourcePane);
          e.preventDefault();
        } else if (nearBottom) {
          this.splitEdge('bottom', sid, copy, sourcePane);
          e.preventDefault();
        }
      }
    });
  }

  initFromDom() {
    // Start with a single cell
    this.rows = 1; this.cols = 1; this.widths = [100]; this.heights = [100];
    this.panes = [new ClaudePane(0, this.app)];
    this.tabs = [{ list: [], active: null }];
    this.rebuildGrid();
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
      // Hide the single-pane container to avoid an empty column gap
      tc.style.display = 'none';
      const tw = tc.querySelector('.terminal-wrapper');
      if (tw) tw.style.display = 'none';
    }
    this.container.style.display = 'flex';
    this.applySplit();
    // Default: left pane uses current active session
    const active = this.app?.currentClaudeSessionId;
    if (active) this.assignSession(0, active);
    this.focusPane(this.activeIndex || 0);
    // Keep global tabs visible; they target the active pane (VS Code-style)
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
    // Global tabs remain visible in both modes
    this.persist();
  }

  applySplit() {
    // Build columns and rows with resizers between tracks
    const cols = [];
    this.widths.forEach((w, i) => { cols.push(`${w}%`); if (i < this.widths.length - 1) cols.push('6px'); });
    const rows = [];
    this.heights.forEach((h, i) => { rows.push(`${h}%`); if (i < this.heights.length - 1) rows.push('6px'); });
    this.grid.style.gridTemplateColumns = cols.join(' ');
    this.grid.style.gridTemplateRows = rows.join(' ');
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
        heights: this.heights,
        rows: this.rows,
        cols: this.cols,
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
      if (Array.isArray(st.widths) && st.widths.length >= 1) this.widths = st.widths;
      if (Array.isArray(st.heights) && st.heights.length >= 1) this.heights = st.heights;
      if (typeof st.rows === 'number' && st.rows >= 1) this.rows = Math.min(2, st.rows);
      if (typeof st.cols === 'number' && st.cols >= 1) this.cols = Math.max(1, Math.min(4, st.cols));
      if (st.enabled) {
        // Rebuild grid now with stored rows/cols
        this.rebuildGrid();
        // rebuild pane tabs after sessions list loads
        setTimeout(() => {
          this.tabs = (st.tabs || []).map(t => ({ list: Array.isArray(t.list) ? t.list : [], active: t.active || null }));
          while (this.tabs.length < this.panes.length) this.tabs.push({ list: [], active: null });
          for (let i = 0; i < this.panes.length; i++) {
            this.renderPaneTabs(i);
            const t = this.tabs[i];
            if (t && t.active) this.panes[i]?.setSession(t.active);
          }
          this.enable();
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

  bindRowResizer(rz, topRowIndex) {
    let dragging = false;
    let startY = 0;
    let startTop = 0;
    let startBottom = 0;
    const onDown = (e) => {
      dragging = true;
      startY = (e.touches ? e.touches[0].clientY : e.clientY);
      startTop = this.heights[topRowIndex];
      startBottom = this.heights[topRowIndex + 1];
      document.body.style.userSelect = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const y = (e.touches ? e.touches[0].clientY : e.clientY);
      const rect = this.grid.getBoundingClientRect();
      const deltaPct = ((y - startY) / rect.height) * 100;
      let newTop = Math.max(10, Math.min(90, startTop + deltaPct));
      let newBottom = startTop + startBottom - newTop;
      if (newBottom < 10) { newBottom = 10; newTop = startTop + startBottom - 10; }
      this.heights[topRowIndex] = newTop;
      this.heights[topRowIndex + 1] = newBottom;
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
    const ensureHints = () => {
      let hints = paneEl.querySelector('.pane-drop-hints');
      if (!hints) {
        hints = document.createElement('div');
        hints.className = 'pane-drop-hints';
        hints.innerHTML = '<div class="hint left"></div><div class="hint right"></div><div class="hint top"></div><div class="hint bottom"></div>';
        paneEl.appendChild(hints);
      }
      return hints;
    };
    const clearHints = () => {
      const h = paneEl.querySelector('.pane-drop-hints');
      if (h) { h.querySelectorAll('.hint').forEach(el => el.classList.remove('active')); h.style.display = 'none'; }
    };
    const highlight = (dir) => {
      const h = ensureHints();
      h.style.display = 'block';
      h.querySelectorAll('.hint').forEach(el => el.classList.remove('active'));
      if (!dir) return;
      const sel = dir === 'left' ? '.left' : dir === 'right' ? '.right' : dir === 'top' ? '.top' : '.bottom';
      const el = h.querySelector(sel); if (el) el.classList.add('active');
    };
    paneEl.addEventListener('dragover', (e) => {
      e.preventDefault(); paneEl.classList.add('drag-over');
      e.dataTransfer.dropEffect = (e.ctrlKey || e.metaKey) ? 'copy' : 'move';
      const r = paneEl.getBoundingClientRect();
      const x = e.clientX - r.left; const y = e.clientY - r.top;
      const left = x < r.width * 0.28;
      const right = x > r.width * 0.72;
      const top = y < r.height * 0.28;
      const bottom = y > r.height * 0.72;
      let dir = null;
      if (left) dir = 'left'; else if (right) dir = 'right'; else if (top) dir = 'top'; else if (bottom) dir = 'bottom';
      highlight(dir);
    });
    paneEl.addEventListener('dragleave', () => { paneEl.classList.remove('drag-over'); clearHints(); });
    paneEl.addEventListener('drop', (e) => {
      e.preventDefault(); paneEl.classList.remove('drag-over'); clearHints();
      let sid = e.dataTransfer.getData('application/x-session-id') || e.dataTransfer.getData('text/plain');
      if (!sid) {
        const dragging = document.querySelector('.tabs-container .session-tab.dragging');
        sid = dragging?.dataset?.sessionId || '';
      }
      const copy = !!(e.ctrlKey || e.metaKey);
      if (sid) {
        const r = paneEl.getBoundingClientRect();
        const x = e.clientX - r.left; const y = e.clientY - r.top;
        let dir = null;
        if (x < r.width * 0.28) dir = 'left';
        else if (x > r.width * 0.72) dir = 'right';
        else if (y < r.height * 0.28) dir = 'top';
        else if (y > r.height * 0.72) dir = 'bottom';
        const sourcePane = parseInt(e.dataTransfer.getData('x-source-pane') || '-1', 10);
        if (dir) {
          this.splitAt(index, dir, sid, copy);
        } else {
          this.assignSession(index, sid);
          if (!copy && !isNaN(sourcePane) && sourcePane >= 0 && sourcePane !== index) this.removeTabFromPane(sourcePane, sid);
        }
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
        e.dataTransfer.effectAllowed = 'copyMove';
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
      // close: fully close the session
      el.querySelector('.close').addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.closeSessionCompletely(sid);
      });
      // context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openPaneTabContextMenu(index, sid, e.clientX, e.clientY);
      });
      holder.appendChild(el);
    });
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.stopPropagation();
        this.focusPane(index);
        this.app?.showFolderBrowser?.();
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
    // Clear the cell
    this.tabs[index] = { list: [], active: null };
    this.panes[index]?.setSession(null);
    this.renderPaneTabs(index);
    // If entire row or column now empty, compress
    const col = index % this.cols; const row = Math.floor(index / this.cols);
    const colEmpty = () => {
      for (let r = 0; r < this.rows; r++) {
        const t = this.tabs[r * this.cols + col];
        if (t && (t.active || (t.list && t.list.length))) return false;
      }
      return true;
    };
    const rowEmpty = () => {
      for (let c = 0; c < this.cols; c++) {
        const t = this.tabs[row * this.cols + c];
        if (t && (t.active || (t.list && t.list.length))) return false;
      }
      return true;
    };
    if (this.cols > 1 && colEmpty()) {
      // Remove the column
      const newPanes = []; const newTabs = [];
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (c === col) continue;
          const idx = r * this.cols + c;
          newPanes.push(this.panes[idx]);
          newTabs.push(this.tabs[idx]);
        }
      }
      this.cols -= 1; this.widths = Array(this.cols).fill(100 / this.cols);
      this.panes = newPanes; this.tabs = newTabs;
      this.rebuildGrid();
    } else if (this.rows > 1 && rowEmpty()) {
      // Remove the row
      const newPanes = []; const newTabs = [];
      for (let r = 0; r < this.rows; r++) {
        if (r === row) continue;
        for (let c = 0; c < this.cols; c++) {
          const idx = r * this.cols + c;
          newPanes.push(this.panes[idx]);
          newTabs.push(this.tabs[idx]);
        }
      }
      this.rows -= 1; this.heights = [100];
      this.panes = newPanes; this.tabs = newTabs;
      this.rebuildGrid();
    }
    this.persist();
  }

  rebuildGrid() {
    // Normalize arrays length
    const cells = this.rows * this.cols;
    while (this.panes.length < cells) this.panes.push(new ClaudePane(this.panes.length, this.app));
    while (this.tabs.length < cells) this.tabs.push({ list: [], active: null });
    this.panes = this.panes.slice(0, cells);
    this.tabs = this.tabs.slice(0, cells);

    // Clear grid
    this.grid.innerHTML = '';

    // Template tracks
    const cols = []; this.widths = this.widths.slice(0, this.cols);
    this.widths.forEach((w, i) => { cols.push(`${w}%`); if (i < this.cols - 1) cols.push('6px'); });
    const rows = []; this.heights = this.heights.slice(0, this.rows);
    this.heights.forEach((h, i) => { rows.push(`${h}%`); if (i < this.rows - 1) rows.push('6px'); });
    this.grid.style.gridTemplateColumns = cols.join(' ');
    this.grid.style.gridTemplateRows = rows.join(' ');

    // Content cells
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const pane = document.createElement('div');
        pane.className = 'tile-pane';
        pane.dataset.index = String(idx);
        pane.style.gridColumn = String(c * 2 + 1);
        pane.style.gridRow = String(r * 2 + 1);
        pane.innerHTML = `
          <div class="tile-toolbar">
            <div class="pane-tabs" data-index="${idx}"></div>
            <button class="pane-add" data-index="${idx}" title="Add tab">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1=\"12\" y1=\"5\" x2=\"12\" y2=\"19\"/><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/></svg>
            </button>
            <select class="tile-session-select" data-index="${idx}" style="display:none"></select>
            <div class="spacer"></div>
            <button class="tile-close" data-index="${idx}" title="Close Pane">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>
            </button>
          </div>
          <div class="tile-terminal" id="tileTerminal${idx}"></div>`;
        this.grid.appendChild(pane);
        this.bindPaneDnd(pane, idx);
        pane.addEventListener('mousedown', () => this.focusPane(idx));
        pane.querySelector('.tile-toolbar')?.addEventListener('mousedown', () => this.focusPane(idx));
      }
    }

    // Vertical resizers between columns
    for (let i = 0; i < this.cols - 1; i++) {
      const rz = document.createElement('div');
      rz.className = 'resizer';
      rz.dataset.index = String(i);
      rz.style.gridColumn = String(i * 2 + 2);
      rz.style.gridRow = '1 / -1';
      this.grid.appendChild(rz);
      this.bindResizer(rz, i);
    }
    // Horizontal resizers between rows
    for (let r = 0; r < this.rows - 1; r++) {
      const rr = document.createElement('div');
      rr.className = 'row-resizer';
      rr.dataset.index = String(r);
      rr.style.gridRow = String(r * 2 + 2);
      rr.style.gridColumn = '1 / -1';
      this.grid.appendChild(rr);
      this.bindRowResizer(rr, r);
    }

    // Wire controls
    this.grid.querySelectorAll('.tile-close').forEach(btn => btn.addEventListener('click', () => this.removePane(parseInt(btn.dataset.index, 10))));
    this.grid.querySelectorAll('.pane-add').forEach(btn => btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.dataset.index, 10);
      this.focusPane(idx);
      // Shift-click to create a new session directly; normal click opens session picker
      if (e.shiftKey) {
        this.app?.showFolderBrowser?.();
      } else {
        this.openAddMenu(idx, btn);
      }
      e.stopPropagation();
    }));
    this.refreshSessionSelects();
    for (let i = 0; i < this.tabs.length; i++) this.renderPaneTabs(i);
    this.applySplit();
    // Update pane indices and containers
    for (let i = 0; i < this.panes.length; i++) {
      if (this.panes[i]) {
        this.panes[i].index = i;
        this.panes[i].container = document.getElementById(`tileTerminal${i}`);
      }
    }
    // Reattach active sessions to their (possibly re-rendered) terminals
    for (let i = 0; i < this.tabs.length; i++) {
      const t = this.tabs[i];
      if (t && t.active) {
        try { this.panes[i]?.setSession(t.active); } catch (_) {}
      }
    }
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

  async closeSessionCompletely(sessionId) {
    try {
      const headers = window.authManager ? window.authManager.getAuthHeaders() : {};
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE', headers });
    } catch (e) {
      console.error('Failed to delete session', e);
    }
    // Remove from all panes
    this.tabs.forEach((t, i) => {
      const idx = t.list.indexOf(sessionId);
      if (idx >= 0) {
        t.list.splice(idx, 1);
        if (t.active === sessionId) {
          t.active = t.list[idx] || t.list[idx - 1] || t.list[0] || null;
          this.panes[i].setSession(t.active || null);
        }
        this.renderPaneTabs(i);
      }
    });
    // Also remove global tab if present
    try { this.app?.sessionTabManager?.closeSession?.(sessionId); } catch (_) {}
    this.persist();
  }

  // Context menu for per-pane tabs
  openPaneTabContextMenu(index, sid, clientX, clientY) {
    document.querySelectorAll('.pane-session-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'pane-session-menu';
    const addItem = (label, fn) => {
      const el = document.createElement('div');
      el.className = 'pane-session-item';
      el.textContent = label;
      el.onclick = () => { try { fn(); } finally { menu.remove(); } };
      return el;
    };
    // Close Others (within this split)
    menu.appendChild(addItem('Close Others', () => {
      const t = this.tabs[index]; if (!t) return; const others = t.list.filter(x => x !== sid);
      others.forEach(o => this.removeTabFromPane(index, o));
    }));
    // Split Right
    menu.appendChild(addItem('Split Right', () => this.splitAt(index, 'right', sid, false)));
    // Move to Split submenu - list other splits
    if (this.panes.length > 1) {
      const sep = document.createElement('div'); sep.className='pane-session-sep'; menu.appendChild(sep);
      const label = document.createElement('div'); label.className='pane-session-item used'; label.textContent='Move to Split:'; label.style.cursor='default'; menu.appendChild(label);
      for (let i = 0; i < this.panes.length; i++) {
        if (i === index) continue;
        const el = document.createElement('div'); el.className='pane-session-item'; el.textContent = `Split ${i+1}`;
        el.onclick = () => { this.assignSession(i, sid); this.removeTabFromPane(index, sid); menu.remove(); };
        menu.appendChild(el);
      }
    }
    document.body.appendChild(menu);
    menu.style.top = `${clientY + 4}px`;
    menu.style.left = `${clientX + 4}px`;
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  }

  // Split when dragged to the container edge
  splitEdge(direction, sid, copy, sourcePane) {
    if (direction === 'left') {
      if (this.rows * (this.cols + 1) > this.maxPanes) return;
      this.insertColumn(0);
      const target = 0; // top-left
      this.assignSession(target, sid);
      if (!copy && !isNaN(sourcePane) && sourcePane >= 0) this.removeTabFromPane(sourcePane, sid);
    } else if (direction === 'right') {
      if (this.rows * (this.cols + 1) > this.maxPanes) return;
      this.insertColumn(this.cols - 1);
      const target = this.cols - 1; // top-right
      this.assignSession(target, sid);
      if (!copy && !isNaN(sourcePane) && sourcePane >= 0) this.removeTabFromPane(sourcePane, sid);
    } else if (direction === 'top') {
      if ((this.rows + 1) * this.cols > this.maxPanes) return;
      this.insertRow(0);
      const target = 0; // top-left
      this.assignSession(target, sid);
      if (!copy && !isNaN(sourcePane) && sourcePane >= 0) this.removeTabFromPane(sourcePane, sid);
    } else if (direction === 'bottom') {
      if ((this.rows + 1) * this.cols > this.maxPanes) return;
      this.insertRow(this.rows - 1);
      const target = (this.rows - 1) * this.cols; // bottom-left
      this.assignSession(target, sid);
      if (!copy && !isNaN(sourcePane) && sourcePane >= 0) this.removeTabFromPane(sourcePane, sid);
    }
  }

  // Split a specific cell in a given direction
  splitAt(index, direction, sid, copy = false) {
    const oldCols = this.cols; const oldRows = this.rows;
    const col = index % oldCols; const row = Math.floor(index / oldCols);
    if (direction === 'left') {
      if (oldRows * (oldCols + 1) > this.maxPanes) return;
      this.insertColumn(col - 1 < 0 ? 0 : col - 1);
      const target = row * this.cols + col;
      const srcAfter = row * this.cols + (col + 1);
      this.assignSession(target, sid);
      if (!copy) this.removeTabFromPane(srcAfter, sid);
    } else if (direction === 'right') {
      if (oldRows * (oldCols + 1) > this.maxPanes) return;
      this.insertColumn(col);
      const target = row * this.cols + (col + 1);
      const srcAfter = row * this.cols + col;
      this.assignSession(target, sid);
      if (!copy) this.removeTabFromPane(srcAfter, sid);
    } else if (direction === 'top') {
      if ((oldRows + 1) * oldCols > this.maxPanes) return;
      this.insertRow(row - 1 < 0 ? 0 : row - 1);
      const target = row * this.cols + col;
      const srcAfter = (row + 1) * this.cols + col;
      this.assignSession(target, sid);
      if (!copy) this.removeTabFromPane(srcAfter, sid);
    } else if (direction === 'bottom') {
      if ((oldRows + 1) * oldCols > this.maxPanes) return;
      this.insertRow(row);
      const target = (row + 1) * this.cols + col;
      const srcAfter = row * this.cols + col;
      this.assignSession(target, sid);
      if (!copy) this.removeTabFromPane(srcAfter, sid);
    }
  }

  insertColumn(insertAfterCol) {
    const oldCols = this.cols; const rows = this.rows;
    const oldPanes = this.panes.slice(); const oldTabs = this.tabs.map(t => ({ list: [...(t?.list||[])], active: t?.active || null }));
    const newPanes = []; const newTabs = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < oldCols; c++) {
        newPanes.push(oldPanes[r * oldCols + c]);
        newTabs.push(oldTabs[r * oldCols + c]);
        if (c === insertAfterCol) {
          newPanes.push(new ClaudePane(0, this.app));
          newTabs.push({ list: [], active: null });
        }
      }
    }
    this.cols = oldCols + 1;
    this.widths = Array(this.cols).fill(100 / this.cols);
    this.panes = newPanes; this.tabs = newTabs;
    this.rebuildGrid();
  }

  insertRow(insertAfterRow) {
    if (this.rows >= 2) return; // cap rows to 2
    const oldRows = this.rows; const cols = this.cols;
    const oldPanes = this.panes.slice(); const oldTabs = this.tabs.map(t => ({ list: [...(t?.list||[])], active: t?.active || null }));
    const newPanes = []; const newTabs = [];
    for (let r = 0; r < oldRows; r++) {
      for (let c = 0; c < cols; c++) {
        newPanes.push(oldPanes[r * cols + c]);
        newTabs.push(oldTabs[r * cols + c]);
      }
      if (r === insertAfterRow) {
        for (let c = 0; c < cols; c++) { newPanes.push(new ClaudePane(0, this.app)); newTabs.push({ list: [], active: null }); }
      }
    }
    this.rows = oldRows + 1;
    this.heights = this.rows === 2 ? [50, 50] : [100];
    this.panes = newPanes; this.tabs = newTabs;
    this.rebuildGrid();
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
