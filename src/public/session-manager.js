class SessionTabManager {
    constructor(claudeInterface) {
        this.claudeInterface = claudeInterface;
        this.tabs = new Map(); // sessionId -> tab element
        this.activeSessions = new Map(); // sessionId -> session data
        this.activeTabId = null;
        this.tabOrder = []; // visual order of tabs
        this.tabHistory = []; // most recently used order
        this.notificationsEnabled = false;
        this.requestNotificationPermission();
    }

    getAlias(kind) {
        if (this.claudeInterface && typeof this.claudeInterface.getAlias === 'function') {
            return this.claudeInterface.getAlias(kind);
        }
        return kind === 'codex' ? 'Codex' : 'Claude';
    }
    
    requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                // Request permission
                Notification.requestPermission().then(permission => {
                    this.notificationsEnabled = permission === 'granted';
                    if (this.notificationsEnabled) {
                        console.log('Desktop notifications enabled');
                    } else {
                        console.log('Desktop notifications denied');
                    }
                });
            } else if (Notification.permission === 'granted') {
                this.notificationsEnabled = true;
                console.log('Desktop notifications already enabled');
            } else {
                this.notificationsEnabled = false;
                console.log('Desktop notifications blocked');
            }
        } else {
            console.log('Desktop notifications not supported in this browser');
        }
    }
    
    sendNotification(title, body, sessionId) {
        // Don't send notification for active tab
        if (sessionId === this.activeTabId) return;
        
        // Only send notifications if the page is not visible
        if (document.visibilityState === 'visible') return;
        
        // Try desktop notifications first (won't work on iOS Safari)
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                const notification = new Notification(title, {
                    body: body,
                    icon: '/favicon.ico',
                    tag: sessionId,
                    requireInteraction: false,
                    silent: false
                });
                
                notification.onclick = () => {
                    window.focus();
                    this.switchToTab(sessionId);
                    notification.close();
                };
                
                setTimeout(() => notification.close(), 5000);
                console.log(`Desktop notification sent: ${title}`);
                return; // Exit if desktop notification worked
            } catch (error) {
                console.error('Desktop notification failed:', error);
            }
        }
        
        // Fallback for mobile: Use visual + audio/vibration
        this.showMobileNotification(title, body, sessionId);
    }
    
    showMobileNotification(title, body, sessionId) {
        // Update page title to show notification
        const originalTitle = document.title;
        let flashCount = 0;
        const flashInterval = setInterval(() => {
            document.title = flashCount % 2 === 0 ? `• ${title}` : originalTitle;
            flashCount++;
            if (flashCount > 6) {
                clearInterval(flashInterval);
                document.title = originalTitle;
            }
        }, 1000);
        
        // Try to vibrate if available (Android)
        if ('vibrate' in navigator) {
            try {
                navigator.vibrate([200, 100, 200]);
            } catch (e) {
                console.log('Vibration not available');
            }
        }
        
        // Show a toast-style notification at the top of the screen
        const toast = document.createElement('div');
        toast.className = 'mobile-notification';
        toast.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: #3b82f6;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10001;
            max-width: 90%;
            text-align: center;
            cursor: pointer;
            animation: slideDown 0.3s ease-out;
        `;
        
        toast.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">${title}</div>
            <div style="font-size: 14px; opacity: 0.9;">${body}</div>
        `;
        
        // Add CSS animation
        if (!document.querySelector('#mobileNotificationStyles')) {
            const style = document.createElement('style');
            style.id = 'mobileNotificationStyles';
            style.textContent = `
                @keyframes slideDown {
                    from {
                        transform: translateX(-50%) translateY(-100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(-50%) translateY(0);
                        opacity: 1;
                    }
                }
                @keyframes slideUp {
                    from {
                        transform: translateX(-50%) translateY(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(-50%) translateY(-100%);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        toast.onclick = () => {
            this.switchToTab(sessionId);
            toast.style.animation = 'slideUp 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        };
        
        document.body.appendChild(toast);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideUp 0.3s ease-out';
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
        
        // Play a sound if possible (create a simple beep)
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        } catch (e) {
            console.log('Audio notification not available');
        }
    }

    getOrderedTabIds() {
        // Filter out any ids that may have been removed without updating the order array
        this.tabOrder = this.tabOrder.filter(id => this.tabs.has(id));
        return [...this.tabOrder];
    }

    getOrderedTabElements() {
        return this.getOrderedTabIds()
            .map(id => this.tabs.get(id))
            .filter(Boolean);
    }

    syncOrderFromDom() {
        const tabsContainer = document.getElementById('tabsContainer');
        if (!tabsContainer) return;
        const ids = Array.from(tabsContainer.querySelectorAll('.session-tab'))
            .map(tab => tab.dataset.sessionId)
            .filter(Boolean);
        if (ids.length) {
            this.tabOrder = ids;
        }
    }

    ensureTabVisible(sessionId) {
        const tab = this.tabs.get(sessionId);
        if (!tab) return;
        const scrollContainer = tab.closest('.tabs-section');
        if (!scrollContainer) return;
        const tabRect = tab.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        if (tabRect.left < containerRect.left) {
            scrollContainer.scrollLeft += tabRect.left - containerRect.left - 16;
        } else if (tabRect.right > containerRect.right) {
            scrollContainer.scrollLeft += tabRect.right - containerRect.right + 16;
        }
    }

    updateTabHistory(sessionId) {
        this.tabHistory = this.tabHistory.filter(id => id !== sessionId && this.tabs.has(id));
        this.tabHistory.unshift(sessionId);
        if (this.tabHistory.length > 50) {
            this.tabHistory.length = 50;
        }
    }

    removeFromHistory(sessionId) {
        this.tabHistory = this.tabHistory.filter(id => id !== sessionId);
    }

    async init() {
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
    
    checkAndPromptForNotifications() {
        if ('Notification' in window && Notification.permission === 'default') {
            // Create a small prompt to enable notifications
            const promptDiv = document.createElement('div');
            promptDiv.style.cssText = `
                position: fixed;
                top: 60px;
                right: 20px;
                background: #1e293b;
                border: 1px solid #475569;
                border-radius: 8px;
                padding: 12px 16px;
                color: #e2e8f0;
                font-size: 14px;
                z-index: 10000;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                max-width: 300px;
            `;
            promptDiv.innerHTML = `
                <div style="margin-bottom: 10px;">
                    <strong>Enable Desktop Notifications?</strong><br>
                    Get notified when ${this.getAlias('claude')} completes tasks in background tabs.
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="enableNotifications" style="
                        background: #3b82f6;
                        color: white;
                        border: none;
                        padding: 6px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                    ">Enable</button>
                    <button id="dismissNotifications" style="
                        background: #475569;
                        color: white;
                        border: none;
                        padding: 6px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                    ">Not Now</button>
                </div>
            `;
            document.body.appendChild(promptDiv);
            
            document.getElementById('enableNotifications').onclick = () => {
                this.requestNotificationPermission();
                promptDiv.remove();
            };
            
            document.getElementById('dismissNotifications').onclick = () => {
                promptDiv.remove();
            };
            
            // Auto-dismiss after 10 seconds
            setTimeout(() => {
                if (promptDiv.parentNode) {
                    promptDiv.remove();
                }
            }, 10000);
        }
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
                    e.dataTransfer.effectAllowed = 'copyMove';
                    const sid = e.target.dataset.sessionId;
                    if (sid) {
                        e.dataTransfer.setData('text/plain', sid);
                        e.dataTransfer.setData('application/x-session-id', sid);
                        e.dataTransfer.setData('x-source-pane', '-1');
                    }
                    e.target.classList.add('dragging');
                }
            });
            
            tabsContainer.addEventListener('dragend', (e) => {
                if (e.target.classList.contains('session-tab')) {
                    e.target.classList.remove('dragging');
                    this.syncOrderFromDom();
                    this.updateTabOverflow();
                    this.updateOverflowMenu();
                }
            });
            
            tabsContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
                const draggingTab = tabsContainer.querySelector('.dragging');
                if (!draggingTab) return;
                const afterElement = this.getDragAfterElement(tabsContainer, e.clientX);
                
                if (afterElement == null) {
                    tabsContainer.appendChild(draggingTab);
                } else {
                    tabsContainer.insertBefore(draggingTab, afterElement);
                }
            });

            tabsContainer.addEventListener('drop', (e) => {
                e.preventDefault();
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
            this.updateOverflowMenu();
        });
    }
    
    updateTabOverflow() {
        const isMobile = window.innerWidth <= 768;
        const overflowWrapper = document.getElementById('tabOverflowWrapper');
        const overflowCount = document.querySelector('.tab-overflow-count');
        
        if (!isMobile) {
            // On desktop, show all tabs and hide overflow
            this.tabs.forEach(tab => {
                tab.style.display = '';
            });
            if (overflowWrapper) {
                overflowWrapper.style.display = 'none';
            }
            if (overflowCount) overflowCount.textContent = '';
            return;
        }
        
        // On mobile, show only first 2 tabs
        const tabsArray = this.getOrderedTabElements();
        
        tabsArray.forEach((tab, index) => {
            if (index < 2) {
                tab.style.display = ''; // Show first 2 tabs
            } else {
                tab.style.display = 'none'; // Hide rest
            }
        });
        
        if (tabsArray.length > 2) {
            // Show overflow button with count
            if (overflowWrapper) {
                overflowWrapper.style.display = 'flex';
                if (overflowCount) {
                    overflowCount.textContent = tabsArray.length - 2;
                }
            }
        } else {
            // Hide overflow button
            if (overflowWrapper) {
                overflowWrapper.style.display = 'none';
            }
            if (overflowCount) {
                overflowCount.textContent = '';
            }
        }
    }
    
    updateOverflowMenu() {
        const menu = document.getElementById('tabOverflowMenu');
        if (!menu) return;
        
        const overflowIds = this.getOrderedTabIds().slice(2);
        
        menu.innerHTML = '';
        
        overflowIds.forEach((sessionId) => {
            const tabElement = this.tabs.get(sessionId);
            if (!tabElement) return;
            const session = this.activeSessions.get(sessionId);
            if (!session) return;
            
            const item = document.createElement('div');
            item.className = 'overflow-tab-item';
            if (sessionId === this.activeTabId) {
                item.classList.add('active');
            }
            
            item.innerHTML = `
                <span class="overflow-tab-name">${tabElement.querySelector('.tab-name').textContent}</span>
                <span class="overflow-tab-close" data-session-id="${sessionId}" title="Close tab">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </span>
            `;
            
            // Click to switch to tab
            item.addEventListener('click', async (e) => {
                if (!e.target.classList.contains('overflow-tab-close')) {
                    await this.switchToTab(sessionId);
                    menu.classList.remove('active');
                    // Update menu contents after switching - use a slightly longer delay to ensure UI updates
                    setTimeout(() => {
                        this.updateTabOverflow();
                        this.updateOverflowMenu();
                    }, 150);
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
            console.log('[SessionManager.loadSessions] Fetching sessions from server...');
            const authHeaders = window.authManager ? window.authManager.getAuthHeaders() : {};
            const response = await fetch('/api/sessions/list', {
                headers: authHeaders
            });
            const data = await response.json();
            
            console.log('[SessionManager.loadSessions] Got data:', data);
            
            // Sort sessions by creation time (assuming older sessions should be less recent)
            // This provides a default order that will be updated as tabs are accessed
            const sessions = data.sessions || [];
            
            console.log('[SessionManager.loadSessions] Processing', sessions.length, 'sessions');
            
            sessions.forEach((session, index) => {
                console.log('[SessionManager.loadSessions] Adding tab for:', session.id);
                // Don't auto-switch when loading existing sessions
                this.addTab(session.id, session.name, session.active ? 'active' : 'idle', session.workingDir, false);
                // Set initial timestamps based on order (older sessions get older timestamps)
                const sessionData = this.activeSessions.get(session.id);
                if (sessionData) {
                    sessionData.lastAccessed = Date.now() - (sessions.length - index) * 1000;
                }
            });
            
            // Reorder tabs based on the initial timestamps (mobile only)
            if (window.innerWidth <= 768) {
                this.reorderTabsByLastAccessed();
            }
            
            console.log('[SessionManager.loadSessions] Final tabs.size:', this.tabs.size);
            
            return sessions;
        } catch (error) {
            console.error('Failed to load sessions:', error);
            return [];
        }
    }

    addTab(sessionId, sessionName, status = 'idle', workingDir = null, autoSwitch = true) {
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
            <span class="tab-close" title="Close tab">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </span>
        `;
        
        // Tab click handler
        tab.addEventListener('click', async (e) => {
            if (!e.target.closest('.tab-close')) {
                await this.switchToTab(sessionId);
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
            if (!e.target.closest('.tab-close')) {
                this.renameTab(sessionId);
            }
        });

        // Middle click to close (VS Code behavior)
        tab.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                this.closeSession(sessionId);
            }
        });

        // Context menu: Close Others, Split Right, Move to Split
        tab.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.openTabContextMenu(sessionId, e.clientX, e.clientY);
        });
        
        tabsContainer.appendChild(tab);
        this.tabs.set(sessionId, tab);
        if (!this.tabOrder.includes(sessionId)) {
            this.tabOrder.push(sessionId);
        }

        // Store session data with timestamp and activity tracking
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
        
        // Update overflow on mobile
        this.updateTabOverflow();
        this.updateOverflowMenu();

        // If this is the first tab and autoSwitch is enabled, make it active
        if (this.tabs.size === 1 && autoSwitch) {
            this.switchToTab(sessionId);
        }
    }

    async switchToTab(sessionId, options = {}) {
        if (!this.tabs.has(sessionId)) return;

        const { skipHistoryUpdate = false } = options;

        // Remove active class from all tabs
        this.tabs.forEach(tab => tab.classList.remove('active'));

        // Add active class to selected tab
        const tab = this.tabs.get(sessionId);
        if (!tab) return;
        tab.classList.add('active');
        this.activeTabId = sessionId;
        this.ensureTabVisible(sessionId);

        // Update last accessed timestamp and clear unread indicator
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.lastAccessed = Date.now();
            if (session.unreadOutput) this.updateUnreadIndicator(sessionId, false);
        }

        if (!skipHistoryUpdate) {
            this.updateTabHistory(sessionId);
        }

        if (window.innerWidth <= 768) {
            const tabIndex = this.getOrderedTabIds().indexOf(sessionId);
            if (tabIndex >= 2) this.reorderTabsByLastAccessed();
        }

        this.updateOverflowMenu();

        // If tile view is enabled, tabs target the active pane (VS Code-style)
        await this.claudeInterface.joinSession(sessionId);
        this.updateHeaderInfo(sessionId);
    }
    
    reorderTabsByLastAccessed() {
        const tabsContainer = document.getElementById('tabsContainer');
        if (!tabsContainer) return;
        
        // Get all tabs sorted by last accessed time (most recent first)
        const sortedIds = this.getOrderedTabIds()
            .sort((a, b) => {
                const sessionA = this.activeSessions.get(a);
                const sessionB = this.activeSessions.get(b);
                const timeA = sessionA ? sessionA.lastAccessed : 0;
                const timeB = sessionB ? sessionB.lastAccessed : 0;
                return timeB - timeA; // Most recent first
            });

        sortedIds.forEach((sessionId) => {
            const tabElement = this.tabs.get(sessionId);
            if (tabElement) {
                tabsContainer.appendChild(tabElement);
            }
        });

        this.tabOrder = sortedIds;
        
        // Update overflow on mobile
        this.updateTabOverflow();
    }

    closeSession(sessionId, { skipServerRequest = false } = {}) {
        const tab = this.tabs.get(sessionId);
        if (!tab) return;

        const orderedIds = this.getOrderedTabIds();
        const closedIndex = orderedIds.indexOf(sessionId);

        // Remove tab
        tab.remove();
        this.tabs.delete(sessionId);
        this.activeSessions.delete(sessionId);
        this.tabOrder = orderedIds.filter(id => id !== sessionId);
        this.removeFromHistory(sessionId);

        // Update overflow on mobile
        this.updateTabOverflow();
        this.updateOverflowMenu();

        if (!skipServerRequest) {
            const authHeaders = window.authManager ? window.authManager.getAuthHeaders() : {};
            fetch(`/api/sessions/${sessionId}`, { 
                method: 'DELETE',
                headers: authHeaders
            })
                .catch(err => console.error('Failed to delete session:', err));
        }

        // If this was the active tab, switch to another
        if (this.activeTabId === sessionId) {
            this.activeTabId = null;
            let fallbackId = this.tabHistory.find(id => this.tabs.has(id));
            if (!fallbackId && this.tabOrder.length > 0) {
                const nextIndex = closedIndex >= 0 ? Math.min(closedIndex, this.tabOrder.length - 1) : 0;
                fallbackId = this.tabOrder[nextIndex];
            }

            if (fallbackId) {
                this.switchToTab(fallbackId);
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

    // Close all other tabs except the given session
    closeOthers(sessionId) {
        const ids = this.getOrderedTabIds();
        ids.forEach(id => { if (id !== sessionId) this.closeSession(id); });
    }

    // Context menu for a session tab
    openTabContextMenu(sessionId, clientX, clientY) {
        // Remove existing menus
        document.querySelectorAll('.pane-session-menu').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 'pane-session-menu';
        const addItem = (label, fn, disabled = false) => {
            const el = document.createElement('div');
            el.className = 'pane-session-item' + (disabled ? ' used' : '');
            el.textContent = label;
            if (!disabled) el.onclick = () => { try { fn(); } finally { menu.remove(); } };
            return el;
        };
        menu.appendChild(addItem('Close Others', () => this.closeOthers(sessionId)));
        document.body.appendChild(menu);
        menu.style.top = `${clientY + 4}px`;
        menu.style.left = `${clientX + 4}px`;
        const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
        setTimeout(() => document.addEventListener('mousedown', close, true), 0);
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
        if (this.tabHistory.length > 1) {
            const nextId = this.tabHistory.find((id) => id !== this.activeTabId && this.tabs.has(id));
            if (nextId) {
                this.switchToTab(nextId);
                return;
            }
        }

        const tabIds = this.getOrderedTabIds();
        if (tabIds.length === 0) return;
        const currentIndex = tabIds.indexOf(this.activeTabId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tabIds.length : 0;
        this.switchToTab(tabIds[nextIndex]);
    }

    switchToPreviousTab() {
        const tabIds = this.getOrderedTabIds();
        if (tabIds.length === 0) return;
        const currentIndex = tabIds.indexOf(this.activeTabId);
        const prevIndex = currentIndex >= 0 ? (currentIndex - 1 + tabIds.length) % tabIds.length : tabIds.length - 1;
        this.switchToTab(tabIds[prevIndex]);
    }

    switchToTabByIndex(index) {
        const tabIds = this.getOrderedTabIds();
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
                // Get current session info
                const session = this.activeSessions.get(sessionId);
                const wasActive = session && session.status === 'active';
                
                // Preserve unread class if it exists
                const hasUnread = statusEl.classList.contains('unread');
                statusEl.className = `tab-status ${status}`;
                
                // When transitioning from active to idle for background tabs, mark as unread
                if (wasActive && status === 'idle' && sessionId !== this.activeTabId) {
                    statusEl.classList.add('unread');
                    if (session) {
                        session.unreadOutput = true;
                    }
                } else if (hasUnread) {
                    statusEl.classList.add('unread');
                }
                
                // Update visual indicator based on status
                if (status === 'active') {
                    statusEl.classList.add('pulse');
                } else {
                    statusEl.classList.remove('pulse');
                }
            }
            
            const session = this.activeSessions.get(sessionId);
            if (session) {
                session.status = status;
                session.lastActivity = Date.now();
                
                // Clear error state if status is not error
                if (status !== 'error') {
                    session.hasError = false;
                }
            }
        }
    }
    
    markSessionActivity(sessionId, hasOutput = false, outputData = '') {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;
        
        const previousActivity = session.lastActivity || 0;
        const wasActive = session.status === 'active';
        session.lastActivity = Date.now();
        
        // Update status to active if there's output
        if (hasOutput) {
            this.updateTabStatus(sessionId, 'active');
            
            // Don't mark as unread immediately - wait for completion
            // This prevents the blue indicator from showing while Claude is still working
            
            // Clear any existing timeouts
            clearTimeout(session.idleTimeout);
            clearTimeout(session.workCompleteTimeout);
            
            // Set a 90-second timeout to detect when Claude has likely finished working
            session.workCompleteTimeout = setTimeout(() => {
                const currentSession = this.activeSessions.get(sessionId);
                if (currentSession && currentSession.status === 'active') {
                    // Claude has been idle for 90 seconds - likely finished working
                    this.updateTabStatus(sessionId, 'idle');
                    
                    // Only notify and mark as unread if Claude was previously active
                    if (wasActive) {
                        const sessionName = currentSession.name || 'Session';
                        const duration = Date.now() - previousActivity;
                        
                        // Mark as unread if this is a background tab (blue indicator)
                        if (sessionId !== this.activeTabId) {
                            currentSession.unreadOutput = true;
                            this.updateUnreadIndicator(sessionId, true);
                            
                            // Send notification that Claude appears to have finished
                            this.sendNotification(
                                `${sessionName} — ${this.getAlias('claude')} appears finished`,
                                `No output for 90 seconds (worked for ${Math.round(duration / 1000)}s)`,
                                sessionId
                            );
                        }
                    }
                }
            }, 90000); // 90 seconds
            
            // Keep the original 5-minute timeout for full idle state
            session.idleTimeout = setTimeout(() => {
                const currentSession = this.activeSessions.get(sessionId);
                if (currentSession && currentSession.status === 'idle') {
                    // Already marked as idle by the 90-second timeout, no need to do anything
                }
            }, 300000); // 5 minutes
        }
        
        // Check for command completion patterns
        if (hasOutput && outputData) {
            this.checkForCommandCompletion(sessionId, outputData, previousActivity);
        }
    }
    
    checkForCommandCompletion(sessionId, outputData, previousActivity) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;
        
        // Pattern matching for common completion indicators
        const completionPatterns = [
            /build\s+successful/i,
            /compilation\s+finished/i,
            /tests?\s+passed/i,
            /deployment\s+complete/i,
            /npm\s+install.*completed/i,
            /successfully\s+compiled/i,
            /✓\s+All\s+tests\s+passed/i,
            /Done\s+in\s+\d+\.\d+s/i
        ];
        
        const hasCompletion = completionPatterns.some(pattern => pattern.test(outputData));
        
        if (hasCompletion && sessionId !== this.activeTabId) {
            const duration = Date.now() - previousActivity;
            const sessionName = session.name || 'Session';
            
            // Extract a meaningful message from the output
            let message = 'Task completed successfully';
            if (/build\s+successful/i.test(outputData)) {
                message = 'Build completed successfully';
            } else if (/tests?\s+passed/i.test(outputData)) {
                message = 'All tests passed';
            } else if (/deployment\s+complete/i.test(outputData)) {
                message = 'Deployment completed';
            }
            
            // Mark tab as unread (blue indicator) for completed tasks
            session.unreadOutput = true;
            this.updateUnreadIndicator(sessionId, true);
            
            this.sendNotification(
                `${sessionName}`,
                message,
                sessionId
            );
        }
    }
    
    updateUnreadIndicator(sessionId, hasUnread) {
        const tab = this.tabs.get(sessionId);
        if (tab) {
            const statusEl = tab.querySelector('.tab-status');
            if (hasUnread) {
                tab.classList.add('has-unread');
                // Add unread class to status indicator instead of creating new element
                if (statusEl) {
                    statusEl.classList.add('unread');
                }
            } else {
                tab.classList.remove('has-unread');
                // Remove unread class from status indicator
                if (statusEl) {
                    statusEl.classList.remove('unread');
                }
            }
        }
        
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.unreadOutput = hasUnread;
        }
    }
    
    markSessionError(sessionId, hasError = true) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.hasError = hasError;
            if (hasError) {
                this.updateTabStatus(sessionId, 'error');
                
                // Send notification for error in background session
                const sessionName = session.name || 'Session';
                this.sendNotification(
                    `Error in ${sessionName}`,
                    'A command has failed or the session encountered an error',
                    sessionId
                );
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
