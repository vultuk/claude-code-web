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
        this.folderMode = false;
        this.currentFolderPath = null;
        this.claudeSessions = [];
        this.isCreatingNewSession = false;
        this.isMobile = this.detectMobile();
        this.currentMode = 'chat';
        
        this.init();
    }

    async init() {
        this.setupTerminal();
        this.setupUI();
        this.loadSettings();
        
        // Show mode switcher on mobile
        if (this.isMobile) {
            this.showModeSwitcher();
        }
        
        // Check if server is in folder mode
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            this.folderMode = config.folderMode;
            
            if (this.folderMode && !config.selectedWorkingDir) {
                // Show folder browser if in folder mode and no directory selected
                this.showFolderBrowser();
            } else {
                // Connect normally
                this.connect().catch(err => console.error('Connection failed:', err));
            }
        } catch (error) {
            console.error('Failed to fetch config:', error);
            this.connect().catch(err => console.error('Connection failed:', err));
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
    
    showModeSwitcher() {
        // Create mode switcher button if it doesn't exist
        if (!document.getElementById('modeSwitcher')) {
            const modeSwitcher = document.createElement('div');
            modeSwitcher.id = 'modeSwitcher';
            modeSwitcher.className = 'mode-switcher';
            modeSwitcher.innerHTML = `
                <button id="modeSwitcherBtn" class="mode-switcher-btn" data-mode="${this.currentMode}" title="Switch mode (Shift+Tab)">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                    </svg>
                </button>
            `;
            document.body.appendChild(modeSwitcher);
            
            // Add event listener
            document.getElementById('modeSwitcherBtn').addEventListener('click', () => {
                this.switchMode();
            });
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
            allowTransparency: true
        });

        this.fitAddon = new FitAddon.FitAddon();
        this.webLinksAddon = new WebLinksAddon.WebLinksAddon();
        
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.webLinksAddon);
        
        this.terminal.open(document.getElementById('terminal'));
        this.fitTerminal();

        this.terminal.onData((data) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.send({ type: 'input', data });
            }
        });

        this.terminal.onResize(({ cols, rows }) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.send({ type: 'resize', cols, rows });
            }
        });
    }

    setupUI() {
        const startBtn = document.getElementById('startBtn');
        const dangerousSkipBtn = document.getElementById('dangerousSkipBtn');
        const reconnectBtn = document.getElementById('reconnectBtn');
        const clearBtn = document.getElementById('clearBtn');
        const settingsBtn = document.getElementById('settingsBtn');
        const retryBtn = document.getElementById('retryBtn');
        const closeSessionBtn = document.getElementById('closeSessionBtn');
        
        // Session management buttons
        const sessionBtn = document.getElementById('sessionBtn');
        const newSessionBtn = document.getElementById('newSessionBtn');
        const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
        
        // Mobile menu buttons
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const closeMenuBtn = document.getElementById('closeMenuBtn');
        const reconnectBtnMobile = document.getElementById('reconnectBtnMobile');
        const clearBtnMobile = document.getElementById('clearBtnMobile');
        const settingsBtnMobile = document.getElementById('settingsBtnMobile');
        const closeSessionBtnMobile = document.getElementById('closeSessionBtnMobile');
        
        startBtn.addEventListener('click', () => this.startClaudeSession());
        dangerousSkipBtn.addEventListener('click', () => this.startClaudeSession({ dangerouslySkipPermissions: true }));
        reconnectBtn.addEventListener('click', () => this.reconnect());
        clearBtn.addEventListener('click', () => this.clearTerminal());
        settingsBtn.addEventListener('click', () => this.showSettings());
        retryBtn.addEventListener('click', () => this.reconnect());
        closeSessionBtn.addEventListener('click', () => this.closeSession());
        
        // Session management event listeners
        sessionBtn.addEventListener('click', () => this.toggleSessionDropdown());
        newSessionBtn.addEventListener('click', () => {
            // Show folder picker for new session
            this.isCreatingNewSession = true;
            this.folderMode = true;
            this.selectedWorkingDir = null;
            this.currentFolderPath = null;
            this.showFolderBrowser();
            document.getElementById('sessionDropdown').classList.remove('active');
        });
        refreshSessionsBtn.addEventListener('click', () => this.loadSessions());
        
        // Mobile menu event listeners
        hamburgerBtn.addEventListener('click', () => this.toggleMobileMenu());
        closeMenuBtn.addEventListener('click', () => this.closeMobileMenu());
        reconnectBtnMobile.addEventListener('click', () => {
            this.reconnect();
            this.closeMobileMenu();
        });
        clearBtnMobile.addEventListener('click', () => {
            this.clearTerminal();
            this.closeMobileMenu();
        });
        settingsBtnMobile.addEventListener('click', () => {
            this.showSettings();
            this.closeMobileMenu();
        });
        closeSessionBtnMobile.addEventListener('click', () => {
            this.closeSession();
            this.closeMobileMenu();
        });
        
        // Mobile sessions button
        const sessionsBtnMobile = document.getElementById('sessionsBtnMobile');
        sessionsBtnMobile.addEventListener('click', () => {
            this.showMobileSessionsModal();
            this.closeMobileMenu();
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('sessionDropdown');
            const sessionBtn = document.getElementById('sessionBtn');
            if (!dropdown.contains(e.target) && !sessionBtn.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });
        
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
            this.showOverlay('loadingSpinner');
            
            try {
                this.socket = new WebSocket(wsUrl);
                
                this.socket.onopen = () => {
                    this.reconnectAttempts = 0;
                    this.updateStatus('Connected');
                    console.log('Connected to server');
                    
                    // Load available sessions
                    this.loadSessions();
                    
                    // Show appropriate overlay based on session state
                    if (!this.currentClaudeSessionId) {
                        this.showOverlay('startPrompt');
                    }
                    
                    // Show close session button if in folder mode
                    if (this.folderMode && this.selectedWorkingDir) {
                        document.getElementById('closeSessionBtn').style.display = 'block';
                        document.getElementById('closeSessionBtnMobile').style.display = 'block';
                    }
                    
                    resolve();
                };
            
            this.socket.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };
            
            this.socket.onclose = (event) => {
                this.updateStatus('Disconnected');
                document.getElementById('reconnectBtn').disabled = false;
                
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
        document.getElementById('reconnectBtn').disabled = true;
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
                this.showOverlay('startPrompt');
                break;
                
            case 'session_joined':
                this.currentClaudeSessionId = message.sessionId;
                this.currentClaudeSessionName = message.sessionName;
                this.updateWorkingDir(message.workingDir);
                this.updateSessionButton(message.sessionName);
                
                // Replay output buffer if available
                if (message.outputBuffer && message.outputBuffer.length > 0) {
                    this.terminal.clear();
                    message.outputBuffer.forEach(data => {
                        this.terminal.write(data);
                    });
                }
                
                // Show appropriate UI based on session state
                if (message.active) {
                    this.hideOverlay();
                    this.terminal.focus();
                } else {
                    this.showOverlay('startPrompt');
                }
                break;
                
            case 'session_left':
                this.currentClaudeSessionId = null;
                this.currentClaudeSessionName = null;
                this.updateSessionButton('Sessions');
                this.terminal.clear();
                this.showOverlay('startPrompt');
                break;
                
            case 'claude_started':
                this.hideOverlay();
                this.terminal.focus();
                this.loadSessions(); // Refresh session list
                break;
                
            case 'claude_stopped':
                this.terminal.writeln(`\r\n\x1b[33mClaude Code stopped\x1b[0m`);
                this.showOverlay('startPrompt');
                this.loadSessions(); // Refresh session list
                break;
                
            case 'output':
                this.terminal.write(message.data);
                break;
                
            case 'exit':
                this.terminal.writeln(`\r\n\x1b[33mClaude Code exited with code ${message.code}\x1b[0m`);
                this.showOverlay('startPrompt');
                this.loadSessions(); // Refresh session list
                break;
                
            case 'error':
                this.showError(message.message);
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
        const statusElement = document.getElementById('status');
        statusElement.textContent = status;
        statusElement.className = 'status ' + status.toLowerCase().replace(/[^a-z]/g, '');
    }

    updateWorkingDir(dir) {
        document.getElementById('workingDir').textContent = dir;
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
        document.getElementById('overlay').style.display = 'none';
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
        
        // If in folder mode and no folder selected, exit
        if (this.folderMode && !this.currentFolderPath) {
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
        
        // If we're creating a new session (either no active session OR explicitly creating new)
        if (!this.currentClaudeSessionId || this.isCreatingNewSession) {
            this.closeFolderBrowser();
            this.showNewSessionModal();
            // Pre-fill the working directory field
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
            document.getElementById('closeSessionBtn').style.display = 'none';
            document.getElementById('closeSessionBtnMobile').style.display = 'none';
            
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
        const dropdown = document.getElementById('sessionDropdown');
        dropdown.classList.toggle('active');
        
        if (dropdown.classList.contains('active')) {
            this.loadSessions();
        }
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
        const sessionList = document.getElementById('sessionList');
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
            
            // Add event listeners for actions
            sessionItem.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.getAttribute('data-action');
                    this.handleSessionAction(action, session.id);
                });
            });
            
            sessionList.appendChild(sessionItem);
        });
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
            await this.connect();
            // Wait a bit for connection to establish
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.send({ type: 'join_session', sessionId });
        document.getElementById('sessionDropdown').classList.remove('active');
    }
    
    leaveSession() {
        this.send({ type: 'leave_session' });
        document.getElementById('sessionDropdown').classList.remove('active');
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
        document.getElementById('sessionBtnText').textContent = text || 'Sessions';
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
                this.folderMode = true;
                this.selectedWorkingDir = null;
                this.currentFolderPath = null;
                this.showFolderBrowser();
            });
        }
    }
    
    showNewSessionModal() {
        document.getElementById('newSessionModal').classList.add('active');
        document.getElementById('sessionDropdown').classList.remove('active');
        
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
            
            // Join the newly created session
            await this.joinSession(data.sessionId);
            
            // Update sessions list
            this.loadSessions();
        } catch (error) {
            console.error('Failed to create session:', error);
            this.showError('Failed to create session');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new ClaudeCodeWebInterface();
    app.startHeartbeat();
});