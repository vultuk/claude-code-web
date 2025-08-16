class ClaudeCodeWebInterface {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.webLinksAddon = null;
        this.socket = null;
        this.connectionId = null;
        this.currentClaudeSessionId = null;
        this.currentClaudeSessionName = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.folderMode = true; // Always use folder mode
        this.currentFolderPath = null;
        this.claudeSessions = [];
        this.isCreatingNewSession = false;
        this.isMobile = this.detectMobile();
        this.currentMode = 'chat';
        this.planDetector = null;
        this.planModal = null;
        
        
        // Initialize the session tab manager
        this.sessionTabManager = null;
        
        this.init();
    }

    async init() {
        this.setupTerminal();
        this.setupUI();
        this.setupPlanDetector();
        this.loadSettings();
        this.disablePullToRefresh();
        
        // Show loading while we initialize
        this.showOverlay('loadingSpinner');
        
        // Initialize the session tab manager and wait for sessions to load
        this.sessionTabManager = new SessionTabManager(this);
        await this.sessionTabManager.init();
        
        // Show mode switcher on mobile
        if (this.isMobile) {
            this.showModeSwitcher();
        }
        
        // Check if there are existing sessions
        console.log('[Init] Checking sessions, tabs.size:', this.sessionTabManager.tabs.size);
        if (this.sessionTabManager.tabs.size > 0) {
            console.log('[Init] Found sessions, connecting...');
            // Sessions exist - connect and join the first one
            await this.connect();
            const firstTabId = this.sessionTabManager.tabs.keys().next().value;
            console.log('[Init] Switching to tab:', firstTabId);
            await this.sessionTabManager.switchToTab(firstTabId);
            
            // Hide overlay completely since we have sessions
            console.log('[Init] About to hide overlay');
            this.hideOverlay();
            console.log('[Init] Overlay should be hidden now');
        } else {
            console.log('[Init] No sessions found, showing folder browser');
            // No sessions - show folder picker to create first session
            this.showFolderBrowser();
        }
        
        window.addEventListener('resize', () => {
            this.fitTerminal();
        });
        
        window.addEventListener('beforeunload', () => {
            this.disconnect();
        });
    }
    
    detectMobile() {
        // Check for touch capability and common mobile user agents
        const hasTouchScreen = 'ontouchstart' in window || 
                              navigator.maxTouchPoints > 0 || 
                              navigator.msMaxTouchPoints > 0;
        
        const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Also check viewport width for tablets
        const smallViewport = window.innerWidth <= 1024;
        
        return hasTouchScreen && (mobileUserAgent || smallViewport);
    }
    
    disablePullToRefresh() {
        // Prevent pull-to-refresh on touchmove
        let lastY = 0;
        
        document.addEventListener('touchstart', (e) => {
            lastY = e.touches[0].clientY;
        }, { passive: false });
        
        document.addEventListener('touchmove', (e) => {
            const y = e.touches[0].clientY;
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
            
            // Prevent pull-to-refresh when at the top and trying to scroll up
            if (scrollTop === 0 && y > lastY) {
                e.preventDefault();
            }
            
            lastY = y;
        }, { passive: false });
        
        // Also prevent overscroll on the terminal element
        const terminal = document.getElementById('terminal');
        if (terminal) {
            terminal.addEventListener('touchmove', (e) => {
                e.stopPropagation();
            }, { passive: false });
        }
    }
    
    showModeSwitcher() {
        // Create mode switcher button if it doesn't exist
        if (!document.getElementById('modeSwitcher')) {
            const modeSwitcher = document.createElement('div');
            modeSwitcher.id = 'modeSwitcher';
            modeSwitcher.className = 'mode-switcher';
            modeSwitcher.innerHTML = `
                <button id="escapeBtn" class="escape-btn" title="Send Escape key">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                </button>
                <button id="modeSwitcherBtn" class="mode-switcher-btn" data-mode="${this.currentMode}" title="Switch mode (Shift+Tab)">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                    </svg>
                </button>
            `;
            document.body.appendChild(modeSwitcher);
            
            // Add event listener for mode switcher
            document.getElementById('modeSwitcherBtn').addEventListener('click', () => {
                this.switchMode();
            });
            
            // Add event listener for escape button
            document.getElementById('escapeBtn').addEventListener('click', () => {
                this.sendEscape();
            });
        }
    }
    
    sendEscape() {
        // Send ESC key to terminal
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // Send ESC key (ASCII 27 or \x1b)
            this.send({ type: 'input', data: '\x1b' });
        }
        
        // Add visual feedback
        const btn = document.getElementById('escapeBtn');
        if (btn) {
            btn.classList.add('pressed');
            setTimeout(() => {
                btn.classList.remove('pressed');
            }, 200);
        }
    }
    
    switchMode() {
        // Toggle between modes
        const modes = ['chat', 'code', 'plan'];
        const currentIndex = modes.indexOf(this.currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.currentMode = modes[nextIndex];
        
        // Update button data attribute for styling
        const btn = document.getElementById('modeSwitcherBtn');
        if (btn) {
            btn.setAttribute('data-mode', this.currentMode);
            btn.title = `Switch mode (Shift+Tab) - Current: ${this.currentMode.charAt(0).toUpperCase() + this.currentMode.slice(1)}`;
        }
        
        // Send Shift+Tab to terminal to trigger actual mode switch in Claude Code
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // Send Shift+Tab key combination (ESC[Z is the terminal sequence for Shift+Tab)
            this.send({ type: 'input', data: '\x1b[Z' });
        }
        
        // Add visual feedback
        if (btn) {
            btn.classList.add('switching');
            setTimeout(() => {
                btn.classList.remove('switching');
            }, 300);
        }
    }

    setupTerminal() {
        // Adjust font size for mobile devices
        const isMobile = this.detectMobile();
        const fontSize = isMobile ? 12 : 14;
        
        this.terminal = new Terminal({
            cursorBlink: true,
            fontSize: fontSize,
            fontFamily: 'JetBrains Mono, Fira Code, Monaco, Consolas, monospace',
            theme: {
                background: 'transparent',
                foreground: '#f0f6fc',
                cursor: '#58a6ff',
                cursorAccent: '#0d1117',
                selection: 'rgba(88, 166, 255, 0.3)',
                black: '#484f58',
                red: '#ff7b72',
                green: '#7ee787',
                yellow: '#ffa657',
                blue: '#79c0ff',
                magenta: '#d2a8ff',
                cyan: '#a5f3fc',
                white: '#b1bac4',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#ffdf5d',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#a5f3fc',
                brightWhite: '#f0f6fc'
            },
            allowProposedApi: true,
            scrollback: 10000,
            rightClickSelectsWord: false,
            allowTransparency: true,
            // Disable focus tracking to prevent ^[[I and ^[[O sequences
            windowOptions: {
                reportFocus: false
            }
        });

        this.fitAddon = new FitAddon.FitAddon();
        this.webLinksAddon = new WebLinksAddon.WebLinksAddon();
        
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.webLinksAddon);
        
        this.terminal.open(document.getElementById('terminal'));
        this.fitTerminal();

        this.terminal.onData((data) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                // Filter out focus tracking sequences before sending
                const filteredData = data.replace(/\x1b\[\[?[IO]/g, '');
                if (filteredData) {
                    this.send({ type: 'input', data: filteredData });
                }
            }
        });

        this.terminal.onResize(({ cols, rows }) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.send({ type: 'resize', cols, rows });
            }
        });
    }

    showSessionSelectionModal() {
        // Create a simple modal to show existing sessions
        const modal = document.createElement('div');
        modal.className = 'session-modal active';
        modal.id = 'sessionSelectionModal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Select a Session</h2>
                    <button class="close-btn" id="closeSessionSelection">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="session-list">
                        ${this.claudeSessions.map(session => {
                            const statusIcon = session.active ? '🟢' : '⚪';
                            const clientsText = session.connectedClients === 1 ? '1 client' : `${session.connectedClients} clients`;
                            return `
                                <div class="session-item" data-session-id="${session.id}" style="cursor: pointer; padding: 15px; border: 1px solid #333; border-radius: 5px; margin-bottom: 10px;">
                                    <div class="session-info">
                                        <span class="session-status">${statusIcon}</span>
                                        <div class="session-details">
                                            <div class="session-name">${session.name}</div>
                                            <div class="session-meta">${clientsText} • ${new Date(session.created).toLocaleString()}</div>
                                            ${session.workingDir ? `<div class="session-folder" title="${session.workingDir}">📁 ${session.workingDir}</div>` : ''}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div style="margin-top: 20px; text-align: center;">
                        <button class="btn btn-secondary" id="selectSessionNewFolder">Load a New Folder Instead</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add event listeners
        modal.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', async () => {
                const sessionId = item.dataset.sessionId;
                await this.joinSession(sessionId);
                modal.remove();
            });
        });
        
        document.getElementById('closeSessionSelection').addEventListener('click', () => {
            modal.remove();
            this.showFolderBrowser();
        });
        
        document.getElementById('selectSessionNewFolder').addEventListener('click', () => {
            modal.remove();
            this.showFolderBrowser();
        });
        
        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                this.showFolderBrowser();
            }
        });
    }
    
    setupUI() {
        const startBtn = document.getElementById('startBtn');
        const dangerousSkipBtn = document.getElementById('dangerousSkipBtn');
        const settingsBtn = document.getElementById('settingsBtn');
        const retryBtn = document.getElementById('retryBtn');
        
        // Mobile menu buttons (keeping for mobile support)
        const closeMenuBtn = document.getElementById('closeMenuBtn');
        const settingsBtnMobile = document.getElementById('settingsBtnMobile');
        
        if (startBtn) startBtn.addEventListener('click', () => this.startClaudeSession());
        if (dangerousSkipBtn) dangerousSkipBtn.addEventListener('click', () => this.startClaudeSession({ dangerouslySkipPermissions: true }));
        if (settingsBtn) settingsBtn.addEventListener('click', () => this.showSettings());
        if (retryBtn) retryBtn.addEventListener('click', () => this.reconnect());
        
        // Mobile menu event listeners
        if (closeMenuBtn) closeMenuBtn.addEventListener('click', () => this.closeMobileMenu());
        if (settingsBtnMobile) {
            settingsBtnMobile.addEventListener('click', () => {
                this.showSettings();
                this.closeMobileMenu();
            });
        }
        
        // Mobile sessions button
        const sessionsBtnMobile = document.getElementById('sessionsBtnMobile');
        if (sessionsBtnMobile) {
            sessionsBtnMobile.addEventListener('click', () => {
                this.showMobileSessionsModal();
                this.closeMobileMenu();
            });
        }
        
        this.setupSettingsModal();
        this.setupFolderBrowser();
        this.setupNewSessionModal();
        this.setupMobileSessionsModal();
    }

    setupSettingsModal() {
        const modal = document.getElementById('settingsModal');
        const closeBtn = document.getElementById('closeSettingsBtn');
        const saveBtn = document.getElementById('saveSettingsBtn');
        const fontSizeSlider = document.getElementById('fontSize');
        const fontSizeValue = document.getElementById('fontSizeValue');
        const themeSelect = document.getElementById('theme');
        const cursorBlinkCheckbox = document.getElementById('cursorBlink');

        closeBtn.addEventListener('click', () => this.hideSettings());
        saveBtn.addEventListener('click', () => this.saveSettings());
        
        fontSizeSlider.addEventListener('input', (e) => {
            fontSizeValue.textContent = e.target.value + 'px';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideSettings();
            }
        });
    }

    connect(sessionId = null) {
        return new Promise((resolve, reject) => {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            let wsUrl = `${protocol}//${location.host}`;
            if (sessionId) {
                wsUrl += `?sessionId=${sessionId}`;
            }
            
            this.updateStatus('Connecting...');
            // Only show loading spinner if overlay is already visible
            // Don't force it to show if we're handling restored sessions
            if (document.getElementById('overlay').style.display !== 'none') {
                this.showOverlay('loadingSpinner');
            }
            
            try {
                this.socket = new WebSocket(wsUrl);
                
                this.socket.onopen = () => {
                    this.reconnectAttempts = 0;
                    this.updateStatus('Connected');
                    console.log('Connected to server');
                    
                    // Load available sessions
                    this.loadSessions();
                    
                    // Only show start prompt if we don't have sessions AND no current session
                    // The init() method will handle showing/hiding overlays for restored sessions
                    if (!this.currentClaudeSessionId && (!this.sessionTabManager || this.sessionTabManager.tabs.size === 0)) {
                        this.showOverlay('startPrompt');
                    }
                    
                    // Show close session button if we have a selected working directory
                    if (this.selectedWorkingDir) {
                        // Close session buttons removed with header
                    }
                    
                    resolve();
                };
            
            this.socket.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };
            
            this.socket.onclose = (event) => {
                this.updateStatus('Disconnected');
                // Reconnect button removed with header
                
                if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
                    setTimeout(() => this.reconnect(), this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
                    this.reconnectAttempts++;
                } else {
                    this.showError('Connection lost. Please check your network and try again.');
                }
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.showError('Failed to connect to the server');
                reject(error);
            };
            
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.showError('Failed to create connection');
            reject(error);
        }
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    reconnect() {
        this.disconnect();
        setTimeout(() => {
            this.connect().catch(err => console.error('Reconnection failed:', err));
        }, 1000);
        // Reconnect button removed with header
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'connected':
                this.connectionId = message.connectionId;
                break;
                
            case 'session_created':
                this.currentClaudeSessionId = message.sessionId;
                this.currentClaudeSessionName = message.sessionName;
                this.updateWorkingDir(message.workingDir);
                this.updateSessionButton(message.sessionName);
                this.loadSessions();
                
                // Add tab for the new session if using tab manager
                if (this.sessionTabManager) {
                    this.sessionTabManager.addTab(message.sessionId, message.sessionName, 'idle', message.workingDir);
                    this.sessionTabManager.switchToTab(message.sessionId);
                }
                
                this.showOverlay('startPrompt');
                break;
                
            case 'session_joined':
                console.log('[session_joined] Message received, active:', message.active, 'tabs:', this.sessionTabManager?.tabs.size);
                this.currentClaudeSessionId = message.sessionId;
                this.currentClaudeSessionName = message.sessionName;
                this.updateWorkingDir(message.workingDir);
                this.updateSessionButton(message.sessionName);
                
                // Update tab status
                if (this.sessionTabManager) {
                    this.sessionTabManager.updateTabStatus(message.sessionId, message.active ? 'active' : 'idle');
                }
                
                // Resolve pending join promise if it exists
                if (this.pendingJoinResolve && this.pendingJoinSessionId === message.sessionId) {
                    this.pendingJoinResolve();
                    this.pendingJoinResolve = null;
                    this.pendingJoinSessionId = null;
                }
                
                // Replay output buffer if available
                if (message.outputBuffer && message.outputBuffer.length > 0) {
                    this.terminal.clear();
                    message.outputBuffer.forEach(data => {
                        // Filter out focus tracking sequences (^[[I and ^[[O)
                        const filteredData = data.replace(/\x1b\[\[?[IO]/g, '');
                        this.terminal.write(filteredData);
                    });
                }
                
                // Show appropriate UI based on session state
                // For restored sessions, Claude won't be active but we still hide the overlay
                // to let users see their session and start Claude when ready
                console.log('[session_joined] Checking if should show overlay. Active:', message.active);
                if (message.active) {
                    console.log('[session_joined] Session is active, hiding overlay');
                    this.hideOverlay();
                    // Don't auto-focus to avoid focus tracking sequences
                    // User can click to focus when ready
                } else {
                    // Session exists but Claude is not running - show start prompt
                    // BUT only if we don't have restored sessions (checked in init)
                    // If this is a restored session, the overlay was already hidden in init()
                    if (!this.sessionTabManager || this.sessionTabManager.tabs.size === 0) {
                        console.log('[session_joined] No tabs, showing start prompt');
                        this.showOverlay('startPrompt');
                    } else {
                        console.log('[session_joined] Have tabs, NOT showing start prompt');
                    }
                }
                break;
                
            case 'session_left':
                this.currentClaudeSessionId = null;
                this.currentClaudeSessionName = null;
                this.updateSessionButton('Sessions');
                this.terminal.clear();
                
                // Update tab status
                if (this.sessionTabManager && message.sessionId) {
                    this.sessionTabManager.updateTabStatus(message.sessionId, 'disconnected');
                }
                
                this.showOverlay('startPrompt');
                break;
                
            case 'claude_started':
                this.hideOverlay();
                // Don't auto-focus to avoid focus tracking sequences
                // User can click to focus when ready
                this.loadSessions(); // Refresh session list
                
                // Update tab status to active
                if (this.sessionTabManager && this.currentClaudeSessionId) {
                    this.sessionTabManager.updateTabStatus(this.currentClaudeSessionId, 'active');
                }
                break;
                
            case 'claude_stopped':
                this.terminal.writeln(`\r\n\x1b[33mClaude Code stopped\x1b[0m`);
                this.showOverlay('startPrompt');
                this.loadSessions(); // Refresh session list
                break;
                
            case 'output':
                // Filter out focus tracking sequences (^[[I and ^[[O)
                const filteredData = message.data.replace(/\x1b\[\[?[IO]/g, '');
                this.terminal.write(filteredData);
                
                // Update session activity indicator with output data
                if (this.sessionTabManager && this.currentClaudeSessionId) {
                    this.sessionTabManager.markSessionActivity(this.currentClaudeSessionId, true, message.data);
                }
                
                // Pass output to plan detector
                if (this.planDetector) {
                    this.planDetector.processOutput(message.data);
                }
                break;
                
            case 'exit':
                this.terminal.writeln(`\r\n\x1b[33mClaude Code exited with code ${message.code}\x1b[0m`);
                
                // Mark session as error if non-zero exit code
                if (this.sessionTabManager && this.currentClaudeSessionId && message.code !== 0) {
                    this.sessionTabManager.markSessionError(this.currentClaudeSessionId, true);
                }
                
                this.showOverlay('startPrompt');
                this.loadSessions(); // Refresh session list
                break;
                
            case 'error':
                this.showError(message.message);
                
                // Mark session as having an error
                if (this.sessionTabManager && this.currentClaudeSessionId) {
                    this.sessionTabManager.markSessionError(this.currentClaudeSessionId, true);
                }
                break;
                
            case 'session_deleted':
                this.showError(message.message);
                this.currentClaudeSessionId = null;
                this.currentClaudeSessionName = null;
                this.updateSessionButton('Sessions');
                this.loadSessions();
                break;
                
            case 'pong':
                break;
                
            default:
                console.log('Unknown message type:', message.type);
        }
    }

    startClaudeSession(options = {}) {
        // If no session, create one first
        if (!this.currentClaudeSessionId) {
            const sessionName = `Session ${new Date().toLocaleString()}`;
            this.send({ 
                type: 'create_session',
                name: sessionName,
                workingDir: this.selectedWorkingDir
            });
            // Wait for session creation, then start Claude
            setTimeout(() => {
                this.send({ type: 'start_claude', options });
            }, 500);
        } else {
            this.send({ type: 'start_claude', options });
        }
        
        this.showOverlay('loadingSpinner');
        const loadingText = options.dangerouslySkipPermissions ? 
            'Starting Claude Code (⚠️ Skipping permissions)...' : 
            'Starting Claude Code...';
        document.getElementById('loadingSpinner').querySelector('p').textContent = loadingText;
    }

    clearTerminal() {
        this.terminal.clear();
    }

    toggleMobileMenu() {
        const mobileMenu = document.getElementById('mobileMenu');
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        mobileMenu.classList.toggle('active');
        hamburgerBtn.classList.toggle('active');
    }

    closeMobileMenu() {
        const mobileMenu = document.getElementById('mobileMenu');
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        mobileMenu.classList.remove('active');
        hamburgerBtn.classList.remove('active');
    }

    fitTerminal() {
        if (this.fitAddon) {
            try {
                this.fitAddon.fit();
                
                // On mobile, ensure terminal doesn't exceed viewport width
                if (this.isMobile) {
                    const terminalElement = document.querySelector('.xterm');
                    if (terminalElement) {
                        const viewportWidth = window.innerWidth;
                        const currentWidth = terminalElement.offsetWidth;
                        
                        if (currentWidth > viewportWidth) {
                            // Reduce columns to fit viewport
                            const charWidth = currentWidth / this.terminal.cols;
                            const maxCols = Math.floor((viewportWidth - 20) / charWidth);
                            this.terminal.resize(maxCols, this.terminal.rows);
                        }
                    }
                }
            } catch (error) {
                console.error('Error fitting terminal:', error);
            }
        }
    }

    updateStatus(status) {
        // Status display removed with header - status now shown in tabs
        console.log('Status:', status);
    }

    updateWorkingDir(dir) {
        // Working dir display removed with header - shown in tab titles
        console.log('Working directory:', dir);
    }

    showOverlay(contentId) {
        const overlay = document.getElementById('overlay');
        const contents = ['loadingSpinner', 'startPrompt', 'errorMessage'];
        
        contents.forEach(id => {
            document.getElementById(id).style.display = id === contentId ? 'block' : 'none';
        });
        
        overlay.style.display = 'flex';
    }

    hideOverlay() {
        const overlay = document.getElementById('overlay');
        if (overlay) {
            console.log('[hideOverlay] Hiding overlay, current display:', overlay.style.display);
            overlay.style.display = 'none';
            console.log('[hideOverlay] Overlay hidden, new display:', overlay.style.display);
        } else {
            console.error('[hideOverlay] Overlay element not found!');
        }
    }

    showError(message) {
        document.getElementById('errorText').textContent = message;
        this.showOverlay('errorMessage');
    }

    showSettings() {
        const modal = document.getElementById('settingsModal');
        modal.classList.add('active');
        
        // Prevent body scroll on mobile when modal is open
        if (this.isMobile) {
            document.body.style.overflow = 'hidden';
        }
        
        const settings = this.loadSettings();
        document.getElementById('fontSize').value = settings.fontSize;
        document.getElementById('fontSizeValue').textContent = settings.fontSize + 'px';
        document.getElementById('theme').value = settings.theme;
        document.getElementById('cursorBlink').checked = settings.cursorBlink;
    }

    hideSettings() {
        document.getElementById('settingsModal').classList.remove('active');
        
        // Restore body scroll
        if (this.isMobile) {
            document.body.style.overflow = '';
        }
    }

    loadSettings() {
        const defaults = {
            fontSize: 14,
            theme: 'dark',
            cursorBlink: true
        };
        
        try {
            const saved = localStorage.getItem('cc-web-settings');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch (error) {
            console.error('Failed to load settings:', error);
            return defaults;
        }
    }

    saveSettings() {
        const settings = {
            fontSize: parseInt(document.getElementById('fontSize').value),
            theme: document.getElementById('theme').value,
            cursorBlink: document.getElementById('cursorBlink').checked
        };
        
        try {
            localStorage.setItem('cc-web-settings', JSON.stringify(settings));
            this.applySettings(settings);
            this.hideSettings();
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    applySettings(settings) {
        document.documentElement.setAttribute('data-theme', settings.theme);
        
        this.terminal.options.fontSize = settings.fontSize;
        this.terminal.options.cursorBlink = settings.cursorBlink;
        
        this.fitTerminal();
    }

    startHeartbeat() {
        setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
            }
        }, 30000);
    }

    // Folder Browser Methods
    setupFolderBrowser() {
        const modal = document.getElementById('folderBrowserModal');
        const upBtn = document.getElementById('folderUpBtn');
        const homeBtn = document.getElementById('folderHomeBtn');
        const selectBtn = document.getElementById('selectFolderBtn');
        const cancelBtn = document.getElementById('cancelFolderBtn');
        const showHiddenCheckbox = document.getElementById('showHiddenFolders');
        const createFolderBtn = document.getElementById('createFolderBtn');
        const confirmCreateBtn = document.getElementById('confirmCreateFolderBtn');
        const cancelCreateBtn = document.getElementById('cancelCreateFolderBtn');
        const newFolderInput = document.getElementById('newFolderNameInput');
        
        upBtn.addEventListener('click', () => this.navigateToParent());
        homeBtn.addEventListener('click', () => this.navigateToHome());
        selectBtn.addEventListener('click', () => this.selectCurrentFolder());
        cancelBtn.addEventListener('click', () => this.closeFolderBrowser());
        showHiddenCheckbox.addEventListener('change', () => this.loadFolders(this.currentFolderPath));
        createFolderBtn.addEventListener('click', () => this.showCreateFolderInput());
        confirmCreateBtn.addEventListener('click', () => this.createFolder());
        cancelCreateBtn.addEventListener('click', () => this.hideCreateFolderInput());
        
        // Allow Enter key to create folder
        newFolderInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.createFolder();
            } else if (e.key === 'Escape') {
                this.hideCreateFolderInput();
            }
        });
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeFolderBrowser();
            }
        });
    }

    async showFolderBrowser() {
        const modal = document.getElementById('folderBrowserModal');
        modal.classList.add('active');
        
        // Prevent body scroll on mobile when modal is open
        if (this.isMobile) {
            document.body.style.overflow = 'hidden';
        }
        
        // Load home directory by default
        await this.loadFolders();
    }

    closeFolderBrowser() {
        const modal = document.getElementById('folderBrowserModal');
        modal.classList.remove('active');
        
        // Restore body scroll
        if (this.isMobile) {
            document.body.style.overflow = '';
        }
        
        // Reset the creating new session flag if canceling
        this.isCreatingNewSession = false;
        
        // If no folder selected, show error
        if (!this.currentFolderPath) {
            this.showError('You must select a folder to continue');
        }
    }

    async loadFolders(path = null) {
        const showHidden = document.getElementById('showHiddenFolders').checked;
        const params = new URLSearchParams();
        if (path) params.append('path', path);
        if (showHidden) params.append('showHidden', 'true');
        
        try {
            const response = await fetch(`/api/folders?${params}`);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to load folders');
            }
            
            const data = await response.json();
            this.currentFolderPath = data.currentPath;
            this.renderFolders(data);
        } catch (error) {
            console.error('Failed to load folders:', error);
            this.showError(`Failed to load folders: ${error.message}`);
        }
    }

    renderFolders(data) {
        const pathInput = document.getElementById('currentPathInput');
        const folderList = document.getElementById('folderList');
        const upBtn = document.getElementById('folderUpBtn');
        
        // Update path display
        pathInput.value = data.currentPath;
        
        // Enable/disable up button
        upBtn.disabled = !data.parentPath;
        
        // Clear and populate folder list
        folderList.innerHTML = '';
        
        if (data.folders.length === 0) {
            folderList.innerHTML = '<div class="empty-folder-message">No folders found</div>';
            return;
        }
        
        data.folders.forEach(folder => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            folderItem.innerHTML = `
                <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="folder-name">${folder.name}</span>
            `;
            folderItem.addEventListener('click', () => this.loadFolders(folder.path));
            folderList.appendChild(folderItem);
        });
    }

    async navigateToParent() {
        if (this.currentFolderPath) {
            const parentPath = this.currentFolderPath.split('/').slice(0, -1).join('/') || '/';
            await this.loadFolders(parentPath);
        }
    }

    async navigateToHome() {
        await this.loadFolders();
    }

    showCreateFolderInput() {
        const createBar = document.getElementById('folderCreateBar');
        const input = document.getElementById('newFolderNameInput');
        createBar.style.display = 'flex';
        input.value = '';
        input.focus();
    }

    hideCreateFolderInput() {
        const createBar = document.getElementById('folderCreateBar');
        const input = document.getElementById('newFolderNameInput');
        createBar.style.display = 'none';
        input.value = '';
    }

    async createFolder() {
        const input = document.getElementById('newFolderNameInput');
        const folderName = input.value.trim();
        
        if (!folderName) {
            this.showError('Please enter a folder name');
            return;
        }
        
        if (folderName.includes('/') || folderName.includes('\\')) {
            this.showError('Folder name cannot contain path separators');
            return;
        }
        
        try {
            const response = await fetch('/api/create-folder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    parentPath: this.currentFolderPath || '/',
                    folderName: folderName
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to create folder');
            }
            
            // Hide the input and reload the folder list
            this.hideCreateFolderInput();
            await this.loadFolders(this.currentFolderPath);
        } catch (error) {
            console.error('Failed to create folder:', error);
            this.showError(`Failed to create folder: ${error.message}`);
        }
    }

    async selectCurrentFolder() {
        if (!this.currentFolderPath) {
            this.showError('No folder selected');
            return;
        }
        
        // Store the selected working directory
        this.selectedWorkingDir = this.currentFolderPath;
        
        // If not connected yet, connect first with the selected directory
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            try {
                // Set the working directory on the server
                const response = await fetch('/api/folders/select', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ path: this.currentFolderPath })
                });
                
                if (!response.ok) throw new Error('Failed to set working directory');
                
                const data = await response.json();
                this.selectedWorkingDir = data.workingDir;
                
                // Update UI - working dir now shown in tab titles
                
                // Close folder browser
                this.closeFolderBrowser();
                
                // Connect to the server
                await this.connect();
                
                // Show new session modal with folder name pre-filled
                this.showNewSessionModal();
                const folderName = this.selectedWorkingDir.split('/').pop() || 'Session';
                document.getElementById('sessionName').value = folderName;
                document.getElementById('sessionWorkingDir').value = this.selectedWorkingDir;
                return;
            } catch (error) {
                console.error('Failed to set working directory:', error);
                this.showError('Failed to set working directory');
                return;
            }
        }
        
        // If we're creating a new session (either no active session OR explicitly creating new)
        if (!this.currentClaudeSessionId || this.isCreatingNewSession) {
            this.closeFolderBrowser();
            this.showNewSessionModal();
            // Pre-fill the session name with folder name and working directory
            const folderName = this.currentFolderPath.split('/').pop() || 'Session';
            document.getElementById('sessionName').value = folderName;
            document.getElementById('sessionWorkingDir').value = this.currentFolderPath;
            this.isCreatingNewSession = false; // Reset the flag
            return;
        }
        
        // Otherwise, set working directory for current session
        try {
            const response = await fetch('/api/set-working-dir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: this.currentFolderPath })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to set working directory');
            }
            
            const result = await response.json();
            console.log('Working directory set to:', result.workingDir);
            
            // Close folder browser and connect
            this.closeFolderBrowser();
            await this.connect();
        } catch (error) {
            console.error('Failed to set working directory:', error);
            this.showError(`Failed to set working directory: ${error.message}`);
        }
    }
    
    async closeSession() {
        try {
            // Send close session message via WebSocket if connected
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.send({ type: 'close_session' });
            }
            
            // Clear the working directory on the server
            const response = await fetch('/api/close-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to close session');
            }
            
            // Reset the local state
            this.selectedWorkingDir = null;
            this.currentFolderPath = null;
            
            // Hide the close session button
            // Close session buttons removed with header
            
            // Disconnect WebSocket
            this.disconnect();
            
            // Clear terminal
            this.clearTerminal();
            
            // Show folder browser again
            this.showFolderBrowser();
            
        } catch (error) {
            console.error('Failed to close session:', error);
            this.showError(`Failed to close session: ${error.message}`);
        }
    }

    // Session Management Methods
    toggleSessionDropdown() {
        // Session dropdown removed with header - using tabs instead
    }
    
    showMobileSessionsModal() {
        document.getElementById('mobileSessionsModal').classList.add('active');
        
        // Prevent body scroll on mobile when modal is open
        if (this.isMobile) {
            document.body.style.overflow = 'hidden';
        }
        
        this.loadMobileSessions();
    }
    
    hideMobileSessionsModal() {
        document.getElementById('mobileSessionsModal').classList.remove('active');
        
        // Restore body scroll
        if (this.isMobile) {
            document.body.style.overflow = '';
        }
    }
    
    async loadMobileSessions() {
        try {
            const response = await fetch('/api/sessions/list');
            if (!response.ok) throw new Error('Failed to load sessions');
            
            const data = await response.json();
            this.claudeSessions = data.sessions;
            this.renderMobileSessionList();
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }
    
    renderMobileSessionList() {
        const sessionList = document.getElementById('mobileSessionList');
        sessionList.innerHTML = '';
        
        if (this.claudeSessions.length === 0) {
            sessionList.innerHTML = '<div class="no-sessions">No active sessions</div>';
            return;
        }
        
        this.claudeSessions.forEach(session => {
            const sessionItem = document.createElement('div');
            sessionItem.className = 'session-item';
            if (session.id === this.currentClaudeSessionId) {
                sessionItem.classList.add('active');
            }
            
            const statusIcon = session.active ? '🟢' : '⚪';
            const clientsText = session.connectedClients === 1 ? '1 client' : `${session.connectedClients} clients`;
            
            sessionItem.innerHTML = `
                <div class="session-info">
                    <span class="session-status">${statusIcon}</span>
                    <div class="session-details">
                        <div class="session-name">${session.name}</div>
                        <div class="session-meta">${clientsText} • ${new Date(session.created).toLocaleTimeString()}</div>
                        ${session.workingDir ? `<div class="session-folder" title="${session.workingDir}">📁 ${session.workingDir.split('/').pop() || '/'}</div>` : ''}
                    </div>
                </div>
                <div class="session-actions">
                    ${session.id === this.currentClaudeSessionId ? 
                        '<button class="btn-icon" title="Leave session" data-action="leave"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>' :
                        '<button class="btn-icon" title="Join session" data-action="join"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></button>'
                    }
                    <button class="btn-icon" title="Delete session" data-action="delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            `;
            
            sessionItem.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = btn.dataset.action;
                    if (action === 'join') {
                        this.joinSession(session.id);
                        this.hideMobileSessionsModal();
                    } else if (action === 'leave') {
                        this.leaveSession(session.id);
                        this.hideMobileSessionsModal();
                    } else if (action === 'delete') {
                        if (confirm(`Delete session "${session.name}"?`)) {
                            this.deleteSession(session.id);
                        }
                    }
                });
            });
            
            sessionList.appendChild(sessionItem);
        });
    }
    
    async loadSessions() {
        try {
            const response = await fetch('/api/sessions/list');
            if (!response.ok) throw new Error('Failed to load sessions');
            
            const data = await response.json();
            this.claudeSessions = data.sessions;
            this.renderSessionList();
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }
    
    renderSessionList() {
        // This method is deprecated - sessions are now displayed as tabs
        // The sessionList element no longer exists as we use tabs instead
        // Keeping empty method to avoid errors from old code references
        return;
    }
    
    handleSessionAction(action, sessionId) {
        switch (action) {
            case 'join':
                this.joinSession(sessionId);
                break;
            case 'leave':
                this.leaveSession();
                break;
            case 'delete':
                this.deleteSession(sessionId);
                break;
        }
    }
    
    async joinSession(sessionId) {
        // Ensure we're connected first
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            // Check if we're already connecting (readyState === 0 means CONNECTING)
            if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
                // Wait for existing connection to complete
                await new Promise((resolve) => {
                    const checkConnection = setInterval(() => {
                        if (this.socket.readyState === WebSocket.OPEN) {
                            clearInterval(checkConnection);
                            resolve();
                        }
                    }, 50);
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        clearInterval(checkConnection);
                        resolve();
                    }, 5000);
                });
            } else {
                // No socket or socket is closed, create new connection
                await this.connect();
                // Wait a bit for connection to establish
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Create a promise that resolves when we receive session_joined message
        return new Promise((resolve) => {
            // Store the resolve function to call when we get the response
            this.pendingJoinResolve = resolve;
            this.pendingJoinSessionId = sessionId;
            
            // Send the join request
            this.send({ type: 'join_session', sessionId });
            
            // Set a timeout in case the response never comes
            setTimeout(() => {
                if (this.pendingJoinResolve) {
                    this.pendingJoinResolve = null;
                    this.pendingJoinSessionId = null;
                    resolve(); // Resolve anyway after timeout
                }
            }, 2000);
        });
    }
    
    leaveSession() {
        this.send({ type: 'leave_session' });
        // Session dropdown removed - using tabs
    }
    
    async deleteSession(sessionId) {
        if (!confirm('Are you sure you want to delete this session? This will stop any running Claude process.')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/sessions/${sessionId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Failed to delete session');
            
            this.loadSessions();
            
            if (sessionId === this.currentClaudeSessionId) {
                this.currentClaudeSessionId = null;
                this.currentClaudeSessionName = null;
                this.updateSessionButton('Sessions');
                this.terminal.clear();
                this.showOverlay('startPrompt');
            }
        } catch (error) {
            console.error('Failed to delete session:', error);
            this.showError('Failed to delete session');
        }
    }
    
    updateSessionButton(text) {
        // Session button removed with header - using tabs instead
        console.log('Session:', text);
    }
    
    setupNewSessionModal() {
        const modal = document.getElementById('newSessionModal');
        const closeBtn = document.getElementById('closeNewSessionBtn');
        const cancelBtn = document.getElementById('cancelNewSessionBtn');
        const createBtn = document.getElementById('createSessionBtn');
        const nameInput = document.getElementById('sessionName');
        const dirInput = document.getElementById('sessionWorkingDir');
        
        closeBtn.addEventListener('click', () => this.hideNewSessionModal());
        cancelBtn.addEventListener('click', () => this.hideNewSessionModal());
        createBtn.addEventListener('click', () => this.createNewSession());
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideNewSessionModal();
            }
        });
        
        // Allow Enter key to create session
        [nameInput, dirInput].forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.createNewSession();
                }
            });
        });
    }
    
    setupMobileSessionsModal() {
        const closeMobileSessionsBtn = document.getElementById('closeMobileSessionsModal');
        const newSessionBtnMobile = document.getElementById('newSessionBtnMobile');
        
        if (closeMobileSessionsBtn) {
            closeMobileSessionsBtn.addEventListener('click', () => this.hideMobileSessionsModal());
        }
        if (newSessionBtnMobile) {
            newSessionBtnMobile.addEventListener('click', () => {
                this.hideMobileSessionsModal();
                // Show folder picker for new session
                this.isCreatingNewSession = true;
                this.selectedWorkingDir = null;
                this.currentFolderPath = null;
                this.showFolderBrowser();
            });
        }
    }
    
    showNewSessionModal() {
        document.getElementById('newSessionModal').classList.add('active');
        // Session dropdown removed - using tabs
        
        // Prevent body scroll on mobile when modal is open
        if (this.isMobile) {
            document.body.style.overflow = 'hidden';
        }
        
        document.getElementById('sessionName').focus();
    }
    
    hideNewSessionModal() {
        document.getElementById('newSessionModal').classList.remove('active');
        
        // Restore body scroll
        if (this.isMobile) {
            document.body.style.overflow = '';
        }
        
        document.getElementById('sessionName').value = '';
        document.getElementById('sessionWorkingDir').value = '';
    }
    
    async createNewSession() {
        const name = document.getElementById('sessionName').value.trim() || `Session ${new Date().toLocaleString()}`;
        const workingDir = document.getElementById('sessionWorkingDir').value.trim() || this.selectedWorkingDir;
        
        if (!workingDir) {
            this.showError('Please select a working directory first');
            return;
        }
        
        try {
            const response = await fetch('/api/sessions/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, workingDir })
            });
            
            if (!response.ok) throw new Error('Failed to create session');
            
            const data = await response.json();
            
            // Hide the modal
            this.hideNewSessionModal();
            
            // Add tab for the new session
            if (this.sessionTabManager) {
                this.sessionTabManager.addTab(data.sessionId, name, 'idle', workingDir);
                this.sessionTabManager.switchToTab(data.sessionId);
            }
            
            // Join the newly created session
            await this.joinSession(data.sessionId);
            
            // Update sessions list
            this.loadSessions();
        } catch (error) {
            console.error('Failed to create session:', error);
            this.showError('Failed to create session');
        }
    }
    
    setupPlanDetector() {
        // Initialize plan detector
        this.planDetector = new PlanDetector();
        this.planModal = document.getElementById('planModal');
        
        // Set up callbacks
        this.planDetector.onPlanDetected = (plan) => {
            this.showPlanModal(plan);
        };
        
        this.planDetector.onPlanModeChange = (isActive) => {
            this.updatePlanModeIndicator(isActive);
        };
        
        // Set up modal buttons
        const acceptBtn = document.getElementById('acceptPlanBtn');
        const rejectBtn = document.getElementById('rejectPlanBtn');
        const closeBtn = document.getElementById('closePlanBtn');
        
        acceptBtn.addEventListener('click', () => this.acceptPlan());
        rejectBtn.addEventListener('click', () => this.rejectPlan());
        closeBtn.addEventListener('click', () => this.hidePlanModal());
        
        // Start monitoring
        this.planDetector.startMonitoring();
    }
    
    showPlanModal(plan) {
        const modal = document.getElementById('planModal');
        const content = document.getElementById('planContent');
        
        // Format the plan content
        let formattedContent = plan.content;
        
        // Convert markdown to basic HTML for better display
        formattedContent = formattedContent
            .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
            .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
            .replace(/^- (.*?)$/gm, '• $1')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
        
        content.innerHTML = formattedContent;
        modal.classList.add('active');
        
        // Play a subtle notification sound (optional)
        this.playNotificationSound();
    }
    
    hidePlanModal() {
        const modal = document.getElementById('planModal');
        modal.classList.remove('active');
    }
    
    acceptPlan() {
        // Send acceptance to Claude
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'input',
                data: 'y\n' // Send 'y' to accept the plan
            }));
        }
        
        this.hidePlanModal();
        this.planDetector.clearBuffer();
        
        // Show confirmation
        this.showNotification('Plan accepted! Claude will begin implementation.');
    }
    
    rejectPlan() {
        // Send rejection to Claude
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'input',
                data: 'n\n' // Send 'n' to reject the plan
            }));
        }
        
        this.hidePlanModal();
        this.planDetector.clearBuffer();
        
        // Show confirmation
        this.showNotification('Plan rejected. You can provide feedback to Claude.');
    }
    
    updatePlanModeIndicator(isActive) {
        const statusElement = document.getElementById('status');
        if (isActive) {
            statusElement.innerHTML = '<span style="color: #10b981;">📋 Plan Mode Active</span>';
        } else {
            // Restore normal status
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                statusElement.textContent = 'Connected';
                statusElement.className = 'status connected';
            }
        }
    }
    
    showNotification(message) {
        // Simple notification - you could enhance this with a toast notification
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--accent);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10002;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    playNotificationSound() {
        // Optional: Play a subtle sound when plan is detected
        // You can add an audio element to play a notification sound
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBRld0Oy9diMFl2+z2e7NeSgFxYvg+8SEIwW3we6eVg0FqOTupjMBSanLvV0OBba37J5QCgU4cLvfvn0cBUCd1Oq2yFSvvayILgm359+2pw8HVqfu3LNDCEij59+NLwBarvfZN20aBVGU4OyrdR0Ff5/i5paFFDGD0+ylVBYF3NTaz38nBThl4fDbmU0NF1PD5uyqUBcIJJDO5buGNggMoNvyx08FB1er/OykQRIKrau3mHs0BQ5azvfZx30VBbDe3LVmFAVK0PC1vnoPC42S4ObNozsJB1Ox58+TYyAKL5zN9r19JAWFz9P6s4s6C2uz+L2VJwUUncflwpdMC0HD5d5sFAVWv+PYiEQIDXq16eyxlSAK57vi75NkBqOZ88WzlnAHl9TmsS8JBaLj4rQ8BigO1/rPuIMtBjGI1PG+kCcFxoTg+bxnMwfSfOL55LVeCn/R+Mltbw8FBpP48KBwKgtDqPDfnzsLCJDZ/dpTWRUHo+S6+M9+lQdRp/DdnysJFXG559GdWwgTgN7z04k2Be/B8d2AUAILJLTy2Y8xBZmduvneOxYFy6H24LhpGgWunuznm0sTDbXm9bldBQuK6u7LfxUIPLH74Z5CBRt37uWmTRgB7ez+0ogeCi+J0Oe4X');
            audio.volume = 0.3;
            audio.play();
        } catch (e) {
            // Ignore sound errors
        }
    }
}

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
    const app = new ClaudeCodeWebInterface();
    app.startHeartbeat();
});