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
    this.resizer = document.getElementById('tileResizer');
    this.panes = [new ClaudePane(0, app), new ClaudePane(1, app)];
    this.splitPos = 50; // percentage
    this.restoreFromStorage();
    this.bindUI();
  }

  bindUI() {
    if (this.resizer) {
      let dragging = false;
      const onMove = (e) => {
        if (!dragging) return;
        const rect = this.grid.getBoundingClientRect();
        const x = e.clientX || (e.touches && e.touches[0]?.clientX);
        const pct = Math.max(15, Math.min(85, ((x - rect.left) / rect.width) * 100));
        this.splitPos = pct;
        this.applySplit();
      };
      this.resizer.addEventListener('mousedown', () => { dragging = true; document.body.style.userSelect = 'none'; });
      window.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
      window.addEventListener('mousemove', onMove);
      this.resizer.addEventListener('touchstart', () => { dragging = true; }, { passive: true });
      window.addEventListener('touchend', () => { dragging = false; }, { passive: true });
      window.addEventListener('touchmove', onMove, { passive: false });
    }
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
    const a = Math.round(this.splitPos);
    const b = 100 - a;
    this.grid.style.gridTemplateColumns = `${a}% 6px ${b}%`;
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
        split: this.splitPos,
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
      if (typeof st.split === 'number') this.splitPos = st.split;
      if (st.enabled) {
        setTimeout(() => this.enable(), 0);
        // sessions will be assigned after app loads sessions; do it lazily
        setTimeout(() => {
          (st.sessions || []).forEach((id, i) => id && this.assignSession(i, id));
        }, 500);
      }
    } catch (_) {}
  }
}

window.PaneManager = PaneManager;
