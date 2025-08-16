class SessionTabManager {
    constructor(claudeInterface) {
        this.claudeInterface = claudeInterface;
        this.tabs = new Map(); // sessionId -> tab element
        this.activeSessions = new Map(); // sessionId -> session data
        this.activeTabId = null;
    }

    async init() {
        this.setupTabBar();
        this.setupKeyboardShortcuts();
        this.setupOverflowDropdown();
        await this.loadSessions();
        this.updateTabOverflow();
    }

    setupTabBar() {
        const tabsContainer = document.getElementById('tabsContainer');
        const newTabBtn = document.getElementById('tabNewBtn');
        
        // New tab button
        newTabBtn?.addEventListener('click', () => {
            this.createNewSession();
        });
        
        // Enable drag and drop for tabs
        if (tabsContainer) {
            tabsContainer.addEventListener('dragstart', (e) => {
                if (e.target.classList.contains('session-tab')) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/html', e.target.innerHTML);
                    e.target.classList.add('dragging');
                }
            });
            
            tabsContainer.addEventListener('dragend', (e) => {
                if (e.target.classList.contains('session-tab')) {
                    e.target.classList.remove('dragging');
                }
            });
            
            tabsContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
                const draggingTab = tabsContainer.querySelector('.dragging');
                const afterElement = this.getDragAfterElement(tabsContainer, e.clientX);
                
                if (afterElement == null) {
                    tabsContainer.appendChild(draggingTab);
                } else {
                    tabsContainer.insertBefore(draggingTab, afterElement);
                }
            });
        }
    }


    setupOverflowDropdown() {
        const overflowBtn = document.getElementById('tabOverflowBtn');
        const overflowMenu = document.getElementById('tabOverflowMenu');
        
        if (overflowBtn) {
            overflowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                overflowMenu.classList.toggle('active');
                this.updateOverflowMenu();
            });
        }
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!overflowMenu?.contains(e.target) && !overflowBtn?.contains(e.target)) {
                overflowMenu?.classList.remove('active');
            }
        });
        
        // Update overflow on window resize
        window.addEventListener('resize', () => {
            this.updateTabOverflow();
        });
    }
    
    updateTabOverflow() {
        const isMobile = window.innerWidth <= 768;
        if (!isMobile) return;
        
        const tabs = Array.from(this.tabs.values());
        const overflowWrapper = document.getElementById('tabOverflowWrapper');
        const overflowCount = document.querySelector('.tab-overflow-count');
        
        if (tabs.length > 2) {
            // Show overflow button with count
            if (overflowWrapper) {
                overflowWrapper.style.display = 'flex';
                if (overflowCount) {
                    overflowCount.textContent = tabs.length - 2;
                }
            }
        } else {
            // Hide overflow button
            if (overflowWrapper) {
                overflowWrapper.style.display = 'none';
            }
        }
    }
    
    updateOverflowMenu() {
        const menu = document.getElementById('tabOverflowMenu');
        if (!menu) return;
        
        const tabs = Array.from(this.tabs.entries());
        const overflowTabs = tabs.slice(2); // Get tabs after the first 2
        
        menu.innerHTML = '';
        
        overflowTabs.forEach(([sessionId, tabElement]) => {
            const session = this.activeSessions.get(sessionId);
            if (!session) return;
            
            const item = document.createElement('div');
            item.className = 'overflow-tab-item';
            if (sessionId === this.activeTabId) {
                item.classList.add('active');
            }
            
            item.innerHTML = `
                <span class="overflow-tab-name">${tabElement.querySelector('.tab-name').textContent}</span>
                <span class="overflow-tab-close" data-session-id="${sessionId}">✕</span>
            `;
            
            // Click to switch to tab
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('overflow-tab-close')) {
                    this.switchToTab(sessionId);
                    menu.classList.remove('active');
                }
            });
            
            // Close button
            const closeBtn = item.querySelector('.overflow-tab-close');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeSession(sessionId);
                menu.classList.remove('active');
            });
            
            menu.appendChild(item);
        });
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

    async loadSessions() {
        try {
            const response = await fetch('/api/sessions/list');
            const data = await response.json();
            
            data.sessions.forEach(session => {
                this.addTab(session.id, session.name, session.active ? 'active' : 'idle', session.workingDir);
            });
            
            return data.sessions || [];
        } catch (error) {
            console.error('Failed to load sessions:', error);
            return [];
        }
    }

    addTab(sessionId, sessionName, status = 'idle', workingDir = null) {
        const tabsContainer = document.getElementById('tabsContainer');
        if (!tabsContainer) return;
        
        // Check if tab already exists
        if (this.tabs.has(sessionId)) {
            return;
        }
        
        const tab = document.createElement('div');
        tab.className = 'session-tab';
        tab.dataset.sessionId = sessionId;
        tab.draggable = true;
        
        // Determine display name:
        // 1. If session name is customized (not default "Session ..."), use it
        // 2. Otherwise, use folder name if available
        // 3. Fall back to session name
        const isDefaultSessionName = sessionName.startsWith('Session ') && sessionName.includes(':');
        const folderName = workingDir ? workingDir.split('/').pop() || '/' : null;
        const displayName = !isDefaultSessionName ? sessionName : (folderName || sessionName);
        
        tab.innerHTML = `
            <div class="tab-content">
                <span class="tab-status ${status}"></span>
                <span class="tab-name" title="${workingDir || sessionName}">${displayName}</span>
            </div>
            <span class="tab-close">✕</span>
        `;
        
        // Tab click handler
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                this.switchToTab(sessionId);
            }
        });
        
        // Close button handler
        const closeBtn = tab.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeSession(sessionId);
        });
        
        // Double-click to rename
        tab.addEventListener('dblclick', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                this.renameTab(sessionId);
            }
        });
        
        tabsContainer.appendChild(tab);
        this.tabs.set(sessionId, tab);
        
        // Store session data
        this.activeSessions.set(sessionId, {
            id: sessionId,
            name: sessionName,
            status: status,
            workingDir: workingDir
        });
        
        // Update overflow on mobile
        this.updateTabOverflow();
        
        // If this is the first tab, make it active
        if (this.tabs.size === 1) {
            this.switchToTab(sessionId);
        }
    }

    switchToTab(sessionId) {
        // Remove active class from all tabs
        this.tabs.forEach(tab => tab.classList.remove('active'));
        
        // Add active class to selected tab
        const tab = this.tabs.get(sessionId);
        if (tab) {
            tab.classList.add('active');
            this.activeTabId = sessionId;
            
            // Switch the main terminal to this session
            this.claudeInterface.joinSession(sessionId);
            
            // Update header info
            this.updateHeaderInfo(sessionId);
        }
    }

    closeSession(sessionId) {
        const tab = this.tabs.get(sessionId);
        if (!tab) return;
        
        // Confirm closure if session is active
        const session = this.activeSessions.get(sessionId);
        if (session && session.status === 'active') {
            if (!confirm(`Close active session "${session.name}"?`)) {
                return;
            }
        }
        
        // Remove tab
        tab.remove();
        this.tabs.delete(sessionId);
        this.activeSessions.delete(sessionId);
        
        // Update overflow on mobile
        this.updateTabOverflow();
        
        // Close the session on server
        fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
            .catch(err => console.error('Failed to delete session:', err));
        
        // If this was the active tab, switch to another
        if (this.activeTabId === sessionId) {
            this.activeTabId = null;
            if (this.tabs.size > 0) {
                const firstTabId = this.tabs.keys().next().value;
                this.switchToTab(firstTabId);
            }
        }
        
    }

    renameTab(sessionId) {
        const tab = this.tabs.get(sessionId);
        if (!tab) return;
        
        const nameSpan = tab.querySelector('.tab-name');
        const currentName = nameSpan.textContent;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'tab-name-input';
        input.style.width = '100%';
        
        nameSpan.replaceWith(input);
        input.focus();
        input.select();
        
        const saveNewName = () => {
            const newName = input.value.trim() || currentName;
            const newNameSpan = document.createElement('span');
            newNameSpan.className = 'tab-name';
            newNameSpan.textContent = newName;
            input.replaceWith(newNameSpan);
            
            // Update session data
            const session = this.activeSessions.get(sessionId);
            if (session) {
                session.name = newName;
            }
        };
        
        input.addEventListener('blur', saveNewName);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                saveNewName();
            } else if (e.key === 'Escape') {
                input.value = currentName;
                saveNewName();
            }
        });
    }

    createNewSession() {
        // Set flag to indicate we're creating a new session
        if (this.claudeInterface) {
            this.claudeInterface.isCreatingNewSession = true;
            // Show the folder browser to let user pick a folder for the new session
            if (this.claudeInterface.showFolderBrowser) {
                this.claudeInterface.showFolderBrowser();
            }
        } else {
            // Fallback: show the folder browser modal directly
            document.getElementById('folderBrowserModal').classList.add('active');
        }
    }

    switchToNextTab() {
        const tabIds = Array.from(this.tabs.keys());
        const currentIndex = tabIds.indexOf(this.activeTabId);
        const nextIndex = (currentIndex + 1) % tabIds.length;
        this.switchToTab(tabIds[nextIndex]);
    }

    switchToPreviousTab() {
        const tabIds = Array.from(this.tabs.keys());
        const currentIndex = tabIds.indexOf(this.activeTabId);
        const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
        this.switchToTab(tabIds[prevIndex]);
    }

    switchToTabByIndex(index) {
        const tabIds = Array.from(this.tabs.keys());
        if (index < tabIds.length) {
            this.switchToTab(tabIds[index]);
        }
    }


    updateHeaderInfo(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            const workingDirEl = document.getElementById('workingDir');
            if (workingDirEl && session.workingDir) {
                workingDirEl.textContent = session.workingDir;
            }
        }
    }

    updateTabStatus(sessionId, status) {
        const tab = this.tabs.get(sessionId);
        if (tab) {
            const statusEl = tab.querySelector('.tab-status');
            if (statusEl) {
                statusEl.className = `tab-status ${status}`;
            }
            
            const session = this.activeSessions.get(sessionId);
            if (session) {
                session.status = status;
            }
        }
    }

    getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.session-tab:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
}

// Export for use in app.js
window.SessionTabManager = SessionTabManager;