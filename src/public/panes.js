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
  }

  async setSession(sessionId) {
    if (this.sessionId === sessionId) return;
    this.disconnect();
    this.sessionId = sessionId;
    if (!sessionId) return;
    this.ensureTerminal();
    await this.connect();
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
    this.maxPanes = 4;
    this.initFromDom();
    this.restoreFromStorage();
    this.bindUI();
  }

  initFromDom() {
    const paneEls = Array.from(this.grid.querySelectorAll('.tile-pane'));
    this.panes = paneEls.map((el, i) => new ClaudePane(i, this.app));
    const count = this.panes.length || 2;
    this.widths = Array(count).fill(100 / count);
    this.applySplit();
  }

  bindUI() {
    // Setup resizers
    this.grid.querySelectorAll('.resizer').forEach((rz, index) => {
      this.bindResizer(rz, index);
    });
    document.querySelectorAll('.tile-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        this.clearPane(idx);
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
    document.getElementById('terminalContainer').style.display = 'none';
    this.container.style.display = 'flex';
    this.applySplit();
    // Default: left pane uses current active session
    const active = this.app?.currentClaudeSessionId;
    if (active) this.assignSession(0, active);
    this.persist();
  }
  disable() {
    this.enabled = false;
    this.container.style.display = 'none';
    document.getElementById('terminalContainer').style.display = '';
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
    this.panes[index].setSession(sessionId);
    this.persist();
  }

  clearPane(index) {
    this.panes[index].setSession(null);
    const sel = document.querySelector(`.tile-session-select[data-index="${index}"]`);
    if (sel) sel.value = '';
    this.persist();
  }

  persist() {
    try {
      const state = {
        enabled: this.enabled,
        widths: this.widths,
        sessions: this.panes.map(p => p.sessionId)
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
        const needed = Math.min(this.maxPanes, Math.max(2, (st.sessions || []).length));
        while (this.panes.length < needed) this.addPane(false);
        this.applySplit();
        // sessions will be assigned after app loads sessions; do it lazily
        setTimeout(() => {
          (st.sessions || []).forEach((id, i) => id && this.assignSession(i, id));
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
      let sid = e.dataTransfer.getData('text/plain');
      if (!sid) {
        const dragging = document.querySelector('.tabs-container .session-tab.dragging');
        sid = dragging?.dataset?.sessionId || '';
      }
      if (sid) this.assignSession(index, sid);
    });
  }
}

window.PaneManager = PaneManager;
