/**
 * Pane Manager
 * Manages individual panes, their tabs, and terminal instances
 */
class PaneManager {
    constructor(splitLayout, claudeInterface) {
        this.splitLayout = splitLayout;
        this.claudeInterface = claudeInterface;
        this.dragDropManager = null; // Will be set after DragDropManager is created
        this.terminals = new Map(); // paneId -> terminal instance
        
        // Bind methods
        this.handlePaneCreated = this.handlePaneCreated.bind(this);
        this.handlePaneRemoved = this.handlePaneRemoved.bind(this);
        this.handlePaneActivated = this.handlePaneActivated.bind(this);
        this.handlePaneResize = this.handlePaneResize.bind(this);
        
        this.init();
    }

    /**
     * Initialize pane manager
     */
    init() {
        // Set up split layout callbacks
        this.splitLayout.onPaneCreated = this.handlePaneCreated;
        this.splitLayout.onPaneRemoved = this.handlePaneRemoved;
        this.splitLayout.onPaneActivated = this.handlePaneActivated;
        
        // Set up resize handling
        document.addEventListener('pane-resize', this.handlePaneResize);
        
        // Initialize the first pane
        const firstPane = this.splitLayout.getActivePane();
        if (firstPane) {
            this.handlePaneCreated(firstPane);
        }
    }

    /**
     * Set the drag drop manager reference
     */
    setDragDropManager(dragDropManager) {
        this.dragDropManager = dragDropManager;
    }

    /**
     * Handle new pane creation
     */
    handlePaneCreated(pane) {
        this.setupPaneTabBar(pane);
        this.createTerminalForPane(pane);
        this.renderPaneTabs(pane);
    }

    /**
     * Handle pane removal
     */
    handlePaneRemoved(pane) {
        // Clean up terminal
        if (this.terminals.has(pane.id)) {
            const terminal = this.terminals.get(pane.id);
            if (terminal.dispose) {
                terminal.dispose();
            }
            this.terminals.delete(pane.id);
        }
        
        // Move tabs to another pane if any exist
        if (pane.tabs.length > 0) {
            const activePanes = this.splitLayout.getPanes().filter(p => p.id !== pane.id);
            if (activePanes.length > 0) {
                const targetPane = activePanes[0];
                pane.tabs.forEach(tab => {
                    tab.sourcePaneId = pane.id;
                    this.splitLayout.moveTabToPane(tab, targetPane.id);
                });
                this.renderPaneTabs(targetPane);
            }
        }
    }

    /**
     * Handle pane activation
     */
    handlePaneActivated(pane) {
        // Switch Claude interface to this pane's active session
        if (pane.activeTabId && this.claudeInterface) {
            const activeTab = pane.tabs.find(tab => tab.id === pane.activeTabId);
            if (activeTab && activeTab.sessionId) {
                this.claudeInterface.joinSession(activeTab.sessionId);
            }
        }
        
        // Focus the terminal in this pane
        this.focusTerminalInPane(pane);
    }

    /**
     * Handle pane resize
     */
    handlePaneResize(event) {
        const paneId = event.detail.paneId;
        const terminal = this.terminals.get(paneId);
        
        if (terminal && terminal.fitAddon) {
            setTimeout(() => {
                try {
                    terminal.fitAddon.fit();
                } catch (error) {
                    console.error('Error fitting terminal:', error);
                }
            }, 50);
        }
    }

    /**
     * Set up tab bar for a pane
     */
    setupPaneTabBar(pane) {
        if (!pane.element) return;
        
        const tabBar = pane.element.querySelector('.pane-tab-bar');
        if (!tabBar) return;
        
        // Create tab container
        const tabContainer = document.createElement('div');
        tabContainer.className = 'pane-tabs-container';
        
        // Create new tab button
        const newTabBtn = document.createElement('button');
        newTabBtn.className = 'pane-new-tab-btn';
        newTabBtn.title = 'New Session (Ctrl+T)';
        newTabBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
        `;
        
        newTabBtn.addEventListener('click', () => {
            this.createNewTabInPane(pane);
        });
        
        // Create close pane button (only show if not the last pane)
        const closePaneBtn = document.createElement('button');
        closePaneBtn.className = 'pane-close-btn';
        closePaneBtn.title = 'Close Pane';
        closePaneBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        `;
        
        closePaneBtn.addEventListener('click', () => {
            if (this.splitLayout.getPanes().length > 1) {
                this.splitLayout.closePane(pane.id);
            }
        });
        
        tabBar.appendChild(tabContainer);
        tabBar.appendChild(newTabBtn);
        tabBar.appendChild(closePaneBtn);
        
        // Store references
        pane.tabContainer = tabContainer;
        pane.closePaneBtn = closePaneBtn;
        
        // Update close button visibility
        this.updateClosePaneButtonVisibility();
    }

    /**
     * Update visibility of close pane buttons
     */
    updateClosePaneButtonVisibility() {
        const panes = this.splitLayout.getPanes();
        const showCloseButtons = panes.length > 1;
        
        panes.forEach(pane => {
            if (pane.closePaneBtn) {
                pane.closePaneBtn.style.display = showCloseButtons ? 'flex' : 'none';
            }
        });
    }

    /**
     * Create terminal for a pane
     */
    createTerminalForPane(pane) {
        const terminalContainer = pane.element.querySelector('.pane-terminal-container');
        if (!terminalContainer) {
            console.warn('Terminal container not found for pane', pane.id);
            return;
        }
        
        // Ensure container is properly attached to DOM
        if (!terminalContainer.isConnected) {
            console.warn('Terminal container not attached to DOM for pane', pane.id);
            // Retry after a short delay
            setTimeout(() => this.createTerminalForPane(pane), 100);
            return;
        }
        
        // Check if Terminal constructor is available
        if (typeof Terminal === 'undefined') {
            console.error('Terminal constructor not available for pane', pane.id);
            return;
        }
        
        // Create terminal instance
        const terminal = new Terminal({
            fontSize: 14,
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

        // Add addons
        if (typeof FitAddon === 'undefined' || typeof WebLinksAddon === 'undefined') {
            console.error('Terminal addons not available for pane', pane.id);
            return;
        }
        
        const fitAddon = new FitAddon.FitAddon();
        const webLinksAddon = new WebLinksAddon.WebLinksAddon();
        
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(webLinksAddon);
        terminal.fitAddon = fitAddon;
        
        // Open terminal
        try {
            terminal.open(terminalContainer);
        } catch (error) {
            console.error('Failed to open terminal for pane', pane.id, error);
            return;
        }
        
        // Store terminal reference
        this.terminals.set(pane.id, terminal);
        pane.terminalInstance = terminal;
        
        // Fit terminal
        setTimeout(() => {
            try {
                fitAddon.fit();
            } catch (error) {
                console.error('Error fitting terminal:', error);
            }
        }, 100);
        
        // Set up data handlers when this becomes the active terminal
        this.setupTerminalHandlers(pane, terminal);
    }

    /**
     * Set up terminal event handlers
     */
    setupTerminalHandlers(pane, terminal) {
        // Only set up handlers for the active pane
        const isActive = pane === this.splitLayout.getActivePane();
        
        if (isActive && this.claudeInterface) {
            // Set up input/output handlers
            terminal.onData((data) => {
                if (this.claudeInterface.socket && this.claudeInterface.socket.readyState === WebSocket.OPEN) {
                    const filteredData = data.replace(/\x1b\[\[?[IO]/g, '');
                    if (filteredData) {
                        this.claudeInterface.send({ type: 'input', data: filteredData });
                    }
                }
            });

            terminal.onResize(({ cols, rows }) => {
                if (this.claudeInterface.socket && this.claudeInterface.socket.readyState === WebSocket.OPEN) {
                    this.claudeInterface.send({ type: 'resize', cols, rows });
                }
            });
        }
    }

    /**
     * Focus terminal in a pane
     */
    focusTerminalInPane(pane) {
        const terminal = this.terminals.get(pane.id);
        if (terminal && terminal.focus) {
            // Focus terminal with a slight delay to ensure DOM is ready
            setTimeout(() => {
                try {
                    terminal.focus();
                } catch (error) {
                    console.error('Error focusing terminal:', error);
                }
            }, 10);
        }
    }

    /**
     * Write data to terminal in specific pane
     */
    writeToTerminal(paneId, data) {
        const terminal = this.terminals.get(paneId);
        if (terminal && terminal.write) {
            const filteredData = data.replace(/\x1b\[\[?[IO]/g, '');
            terminal.write(filteredData);
        }
    }

    /**
     * Clear terminal in specific pane
     */
    clearTerminal(paneId) {
        const terminal = this.terminals.get(paneId);
        if (terminal && terminal.clear) {
            terminal.clear();
        }
    }

    /**
     * Render tabs for a pane
     */
    renderPaneTabs(pane) {
        if (!pane.tabContainer) return;
        
        // Clear existing tabs
        pane.tabContainer.innerHTML = '';
        
        // Render each tab
        pane.tabs.forEach(tab => {
            const tabElement = this.createTabElement(tab, pane);
            pane.tabContainer.appendChild(tabElement);
        });
        
        // Update close pane button visibility
        this.updateClosePaneButtonVisibility();
    }

    /**
     * Create a tab element
     */
    createTabElement(tab, pane) {
        const tabElement = document.createElement('div');
        tabElement.className = 'pane-tab';
        tabElement.dataset.tabId = tab.id;
        tabElement.dataset.paneId = pane.id;
        
        if (tab.id === pane.activeTabId) {
            tabElement.classList.add('active');
        }
        
        // Tab content
        const tabContent = document.createElement('div');
        tabContent.className = 'pane-tab-content';
        
        // Status indicator
        const statusEl = document.createElement('span');
        statusEl.className = `pane-tab-status ${tab.status || 'idle'}`;
        
        // Tab name
        const nameEl = document.createElement('span');
        nameEl.className = 'pane-tab-name';
        nameEl.textContent = tab.name || 'Untitled';
        nameEl.title = tab.workingDir || tab.name || 'Untitled';
        
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'pane-tab-close';
        closeBtn.innerHTML = '✕';
        closeBtn.title = 'Close Tab';
        
        tabContent.appendChild(statusEl);
        tabContent.appendChild(nameEl);
        tabElement.appendChild(tabContent);
        tabElement.appendChild(closeBtn);
        
        // Event handlers
        tabElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('pane-tab-close')) {
                this.activateTabInPane(pane, tab.id);
            }
        });
        
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTabInPane(pane, tab.id);
        });
        
        // Double-click to rename
        tabElement.addEventListener('dblclick', (e) => {
            if (!e.target.classList.contains('pane-tab-close')) {
                this.renameTab(pane, tab);
            }
        });
        
        // Set up drag and drop
        if (this.dragDropManager) {
            this.dragDropManager.enableTabDrag(tabElement, {
                id: tab.id,
                name: tab.name,
                status: tab.status,
                sessionId: tab.sessionId,
                workingDir: tab.workingDir,
                sourcePaneId: pane.id
            });
        }
        
        return tabElement;
    }

    /**
     * Activate a tab in a pane
     */
    activateTabInPane(pane, tabId) {
        const tab = pane.tabs.find(t => t.id === tabId);
        if (!tab) return;
        
        // Update pane state
        pane.activeTabId = tabId;
        
        // Update visual state
        this.renderPaneTabs(pane);
        
        // Switch to this pane and session
        this.splitLayout.setActivePane(pane.id);
        
        // Join the session if it exists
        if (tab.sessionId && this.claudeInterface) {
            this.claudeInterface.joinSession(tab.sessionId);
        }
    }

    /**
     * Close a tab in a pane
     */
    closeTabInPane(pane, tabId) {
        const tabIndex = pane.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return;
        
        const tab = pane.tabs[tabIndex];
        
        // Confirm if session is active
        if (tab.status === 'active') {
            const confirmed = confirm(`Close active session "${tab.name}"?`);
            if (!confirmed) return;
        }
        
        // Remove tab
        pane.tabs.splice(tabIndex, 1);
        
        // Update active tab
        if (pane.activeTabId === tabId) {
            pane.activeTabId = pane.tabs.length > 0 ? pane.tabs[0].id : null;
        }
        
        // Close session on server if it exists
        if (tab.sessionId && this.claudeInterface) {
            fetch(`/api/sessions/${tab.sessionId}`, { 
                method: 'DELETE',
                headers: this.claudeInterface.authManager ? this.claudeInterface.authManager.getAuthHeaders() : {}
            }).catch(err => console.error('Failed to delete session:', err));
        }
        
        // If no tabs left and this isn't the last pane, close the pane
        if (pane.tabs.length === 0 && this.splitLayout.getPanes().length > 1) {
            this.splitLayout.closePane(pane.id);
            return;
        }
        
        // Re-render tabs
        this.renderPaneTabs(pane);
        
        // Activate remaining tab if any
        if (pane.activeTabId) {
            this.activateTabInPane(pane, pane.activeTabId);
        }
    }

    /**
     * Create new tab in pane
     */
    createNewTabInPane(pane) {
        // Show folder browser for new session
        if (this.claudeInterface && this.claudeInterface.showFolderBrowser) {
            this.claudeInterface.isCreatingNewSession = true;
            this.claudeInterface.targetPaneId = pane.id; // Store target pane
            this.claudeInterface.showFolderBrowser();
        }
    }

    /**
     * Add tab to pane
     */
    addTabToPane(pane, tabData) {
        // Ensure tab has required properties
        const tab = {
            id: tabData.id || `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: tabData.name || 'Untitled',
            sessionId: tabData.sessionId,
            status: tabData.status || 'idle',
            workingDir: tabData.workingDir,
            ...tabData
        };
        
        // Add to pane
        pane.tabs.push(tab);
        pane.activeTabId = tab.id;
        
        // Re-render tabs
        this.renderPaneTabs(pane);
        
        // Activate the tab
        this.activateTabInPane(pane, tab.id);
        
        return tab;
    }

    /**
     * Update tab in pane
     */
    updateTabInPane(pane, tabId, updates) {
        const tab = pane.tabs.find(t => t.id === tabId);
        if (!tab) return false;
        
        Object.assign(tab, updates);
        this.renderPaneTabs(pane);
        return true;
    }

    /**
     * Find pane containing tab
     */
    findPaneByTabId(tabId) {
        return this.splitLayout.getPanes().find(pane => 
            pane.tabs.some(tab => tab.id === tabId)
        );
    }

    /**
     * Find pane by session ID
     */
    findPaneBySessionId(sessionId) {
        return this.splitLayout.getPanes().find(pane => 
            pane.tabs.some(tab => tab.sessionId === sessionId)
        );
    }

    /**
     * Rename tab
     */
    renameTab(pane, tab) {
        const currentName = tab.name;
        const newName = prompt('Enter new tab name:', currentName);
        
        if (newName && newName.trim() && newName !== currentName) {
            tab.name = newName.trim();
            this.renderPaneTabs(pane);
        }
    }

    /**
     * Get active terminal
     */
    getActiveTerminal() {
        const activePane = this.splitLayout.getActivePane();
        return activePane ? this.terminals.get(activePane.id) : null;
    }

    /**
     * Get terminal for pane
     */
    getTerminalForPane(paneId) {
        return this.terminals.get(paneId);
    }

    /**
     * Update terminal settings for all panes
     */
    updateTerminalSettings(settings) {
        this.terminals.forEach(terminal => {
            if (settings.fontSize && terminal.options) {
                terminal.options.fontSize = settings.fontSize;
                if (terminal.fitAddon) {
                    setTimeout(() => {
                        try {
                            terminal.fitAddon.fit();
                        } catch (error) {
                            console.error('Error fitting terminal:', error);
                        }
                    }, 50);
                }
            }
        });
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboardShortcut(e) {
        const activePane = this.splitLayout.getActivePane();
        if (!activePane) return false;
        
        // Ctrl/Cmd + T: New tab in active pane
        if ((e.ctrlKey || e.metaKey) && e.key === 't') {
            e.preventDefault();
            this.createNewTabInPane(activePane);
            return true;
        }
        
        // Ctrl/Cmd + W: Close active tab
        if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
            e.preventDefault();
            if (activePane.activeTabId) {
                this.closeTabInPane(activePane, activePane.activeTabId);
            }
            return true;
        }
        
        // Ctrl/Cmd + 1-9: Switch to tab by number
        if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const tabIndex = parseInt(e.key) - 1;
            if (activePane.tabs[tabIndex]) {
                this.activateTabInPane(activePane, activePane.tabs[tabIndex].id);
            }
            return true;
        }
        
        return false;
    }

    /**
     * Cleanup
     */
    destroy() {
        // Clean up all terminals
        this.terminals.forEach(terminal => {
            if (terminal.dispose) {
                terminal.dispose();
            }
        });
        this.terminals.clear();
        
        document.removeEventListener('pane-resize', this.handlePaneResize);
    }
}

// Export for use in other modules
window.PaneManager = PaneManager;