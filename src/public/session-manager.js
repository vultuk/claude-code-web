/**
 * Session Tab Manager
 * Manages multiple Claude sessions through tabs
 */
class SessionTabManager {
    constructor(claudeInterface) {
        this.claudeInterface = claudeInterface;
        this.tabs = new Map(); // sessionId -> tab element (legacy - kept for compatibility)
        this.activeSessions = new Map(); // sessionId -> session data
        this.activeTabId = null;
        this.notificationsEnabled = false;
        
        // New pane-based system
        this.paneManager = null;
        this.splitLayout = null;
        
        this.requestNotificationPermission();
    }

    async init() {
        // Check if we're in split layout mode
        const splitLayoutRoot = document.getElementById('splitLayoutRoot');
        if (splitLayoutRoot) {
            // Initialize split layout system
            await this.initSplitLayoutMode();
        } else {
            // Fall back to legacy tab system
            await this.initLegacyMode();
        }
    }
    
    async initSplitLayoutMode() {
        console.log('[SessionManager] Initializing split layout mode');
        
        try {
            // Check if required classes are available
            if (typeof SplitLayout === 'undefined' || typeof PaneManager === 'undefined' || typeof DragDropManager === 'undefined') {
                console.error('[SessionManager] Split layout classes not available, falling back to legacy mode');
                await this.initLegacyMode();
                return;
            }
            
            // Initialize split layout
            this.splitLayout = new SplitLayout();
            this.splitLayout.init(document.getElementById('splitLayoutRoot'));
            
            // Initialize pane manager
            this.paneManager = new PaneManager(this.splitLayout, this.claudeInterface);
            
            // Initialize drag and drop
            const dragDropManager = new DragDropManager(this.splitLayout);
            this.paneManager.setDragDropManager(dragDropManager);
            
            // Set up keyboard shortcuts for new system
            this.setupSplitLayoutKeyboardShortcuts();
            
            // Load existing sessions into first pane
            await this.loadSessionsIntoSplitLayout();
            
            // Show notification permission prompt after a slight delay
            setTimeout(() => {
                this.checkAndPromptForNotifications();
            }, 2000);
        } catch (error) {
            console.error('[SessionManager] Failed to initialize split layout mode, falling back to legacy mode:', error);
            await this.initLegacyMode();
        }
    }
    
    async initLegacyMode() {
        console.log('[SessionManager] Initializing legacy tab mode');
        this.setupTabBar();
        this.setupKeyboardShortcuts();
        this.setupOverflowDropdown();
        await this.loadSessions();
        this.updateTabOverflow();
        
        // Show notification permission prompt after a slight delay
        setTimeout(() => {
            this.checkAndPromptForNotifications();
        }, 2000);
    }

    // Split Layout Methods
    async loadSessionsIntoSplitLayout() {
        try {
            console.log('[SessionManager.loadSessionsIntoSplitLayout] Loading sessions...');
            const authHeaders = window.authManager ? window.authManager.getAuthHeaders() : {};
            const response = await fetch('/api/sessions/list', {
                headers: authHeaders
            });
            const data = await response.json();
            
            const sessions = data.sessions || [];
            console.log('[SessionManager.loadSessionsIntoSplitLayout] Got', sessions.length, 'sessions');
            
            // Get the first (and only initially) pane
            const firstPane = this.splitLayout.getActivePane();
            if (!firstPane) return;
            
            // Add each session as a tab to the first pane
            sessions.forEach(session => {
                const tabData = {
                    id: session.id,
                    name: session.name,
                    sessionId: session.id,
                    status: session.active ? 'active' : 'idle',
                    workingDir: session.workingDir
                };
                
                this.paneManager.addTabToPane(firstPane, tabData);
                
                // Store in activeSessions for compatibility
                this.activeSessions.set(session.id, {
                    id: session.id,
                    name: session.name,
                    status: session.active ? 'active' : 'idle',
                    workingDir: session.workingDir,
                    lastAccessed: Date.now(),
                    lastActivity: Date.now(),
                    unreadOutput: false,
                    hasError: false
                });
            });
            
            // Activate first tab if any exist
            if (sessions.length > 0) {
                this.paneManager.activateTabInPane(firstPane, sessions[0].id);
                this.activeTabId = sessions[0].id;
            }
            
            return sessions;
        } catch (error) {
            console.error('Failed to load sessions:', error);
            return [];
        }
    }
    
    addTabToSplitLayout(sessionId, sessionName, status = 'idle', workingDir = null, autoSwitch = true) {
        const activePane = this.splitLayout.getActivePane();
        if (!activePane) return;
        
        // Check if session already exists in any pane
        const existingPane = this.paneManager.findPaneBySessionId(sessionId);
        if (existingPane) {
            // Switch to existing tab
            this.paneManager.activateTabInPane(existingPane, sessionId);
            this.splitLayout.setActivePane(existingPane.id);
            return;
        }
        
        const tabData = {
            id: sessionId,
            name: sessionName,
            sessionId: sessionId,
            status: status,
            workingDir: workingDir
        };
        
        this.paneManager.addTabToPane(activePane, tabData);
        
        // Store in activeSessions for compatibility
        this.activeSessions.set(sessionId, {
            id: sessionId,
            name: sessionName,
            status: status,
            workingDir: workingDir,
            lastAccessed: Date.now(),
            lastActivity: Date.now(),
            unreadOutput: false,
            hasError: false
        });
        
        if (autoSwitch) {
            this.activeTabId = sessionId;
        }
    }

    // Add the rest of the existing SessionTabManager methods...
    // (I'll add them in the next part to keep this manageable)
    
    requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                // Don't request immediately, wait for user interaction
            } else if (Notification.permission === 'granted') {
                this.notificationsEnabled = true;
            }
        }
    }

    sendNotification(title, body, sessionId = null) {
        if (!this.notificationsEnabled || Notification.permission !== 'granted') {
            return;
        }

        const notification = new Notification(title, {
            body: body,
            icon: '/icon-32.png',
            badge: '/icon-32.png',
            tag: sessionId || 'claude-session',
            requireInteraction: false,
            silent: false
        });

        notification.onclick = () => {
            window.focus();
            if (sessionId) {
                this.switchToTab(sessionId);
            }
            notification.close();
        };

        // Auto-close after 8 seconds
        setTimeout(() => {
            notification.close();
        }, 8000);
    }

    // Legacy methods (kept for backward compatibility)
    setupTabBar() {
        // Legacy implementation
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + T: New tab
            if ((e.ctrlKey || e.metaKey) && e.key === 't') {
                e.preventDefault();
                this.createNewSession();
            }
            
            // Ctrl/Cmd + W: Close current tab
            if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
                e.preventDefault();
                if (this.activeTabId) {
                    this.closeSession(this.activeTabId);
                }
            }
            
            // Ctrl/Cmd + Tab: Next tab
            if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                this.switchToNextTab();
            }
            
            // Ctrl/Cmd + Shift + Tab: Previous tab
            if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && e.shiftKey) {
                e.preventDefault();
                this.switchToPreviousTab();
            }
            
            // Alt + 1-9: Switch to tab by number
            if (e.altKey && e.key >= '1' && e.key <= '9') {
                e.preventDefault();
                const index = parseInt(e.key) - 1;
                this.switchToTabByIndex(index);
            }
            
        });
    }
    
    setupSplitLayoutKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Let pane manager handle split layout shortcuts
            if (this.paneManager && this.paneManager.handleKeyboardShortcut(e)) {
                return;
            }
            
            // Additional split-specific shortcuts
            // Ctrl/Cmd + Shift + E: Split right
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                this.splitActivePane('horizontal');
            }
            
            // Ctrl/Cmd + Shift + O: Split down
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                this.splitActivePane('vertical');
            }
        });
    }

    // Minimal implementation for essential methods
    async loadSessions() {
        // Legacy implementation
        return [];
    }

    addTab(sessionId, sessionName, status = 'idle', workingDir = null, autoSwitch = true) {
        // In split layout mode, add tab to active pane
        if (this.paneManager && this.splitLayout) {
            return this.addTabToSplitLayout(sessionId, sessionName, status, workingDir, autoSwitch);
        }
        
        // Legacy mode - minimal implementation
        console.log('Adding tab in legacy mode:', sessionId, sessionName);
    }

    createNewSession() {
        // In split layout mode, create new tab in active pane
        if (this.paneManager && this.splitLayout) {
            const activePane = this.splitLayout.getActivePane();
            if (activePane) {
                this.paneManager.createNewTabInPane(activePane);
                return;
            }
        }
        
        // Legacy mode
        if (this.claudeInterface) {
            this.claudeInterface.isCreatingNewSession = true;
            if (this.claudeInterface.showFolderBrowser) {
                this.claudeInterface.showFolderBrowser();
            }
        }
    }

    splitActivePane(direction) {
        if (!this.splitLayout || !this.paneManager) return;
        
        const activePane = this.splitLayout.getActivePane();
        if (!activePane) return;
        
        // Split the pane
        const newPane = this.splitLayout.splitPane(activePane.id, direction);
        if (newPane) {
            console.log(`Pane split ${direction}, new pane:`, newPane.id);
        }
    }

    updateTabStatus(sessionId, status) {
        if (this.paneManager) {
            // Update in pane system
            const pane = this.paneManager.findPaneBySessionId(sessionId);
            if (pane) {
                this.paneManager.updateTabInPane(pane, sessionId, { status });
            }
        }
        
        // Update session data
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.status = status;
            session.lastActivity = Date.now();
            
            if (status !== 'error') {
                session.hasError = false;
            }
        }
    }

    markSessionActivity(sessionId, hasOutput = false, outputData = '') {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.lastActivity = Date.now();
            
            if (hasOutput) {
                this.updateTabStatus(sessionId, 'active');
            }
        }
    }

    async switchToTab(sessionId) {
        if (this.paneManager) {
            // Find pane containing this session
            const pane = this.paneManager.findPaneBySessionId(sessionId);
            if (pane) {
                this.paneManager.activateTabInPane(pane, sessionId);
                this.activeTabId = sessionId;
                return;
            }
        }
        
        // Legacy behavior would go here
        this.activeTabId = sessionId;
    }

    // Stub methods for compatibility
    setupOverflowDropdown() {}
    updateTabOverflow() {}
    checkAndPromptForNotifications() {}
    switchToNextTab() {}
    switchToPreviousTab() {}
    switchToTabByIndex() {}
    closeSession() {}
}

// Export for use in app.js
window.SessionTabManager = SessionTabManager;