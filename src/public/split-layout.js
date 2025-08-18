/**
 * Split Layout Manager
 * Manages the hierarchical layout of split panes in a VS Code-style interface
 */
class SplitLayout {
    constructor() {
        this.root = null;
        this.activePane = null;
        this.panes = new Map();
        this.nextPaneId = 1;
        this.onPaneCreated = null;
        this.onPaneRemoved = null;
        this.onPaneActivated = null;
        this.onLayoutChanged = null;
        
        // Bind methods
        this.handleResize = this.handleResize.bind(this);
        this.handleGutterDoubleClick = this.handleGutterDoubleClick.bind(this);
        
        // Set up resize observer for layout updates
        this.resizeObserver = new ResizeObserver(entries => {
            this.updatePaneSizes();
        });
    }

    /**
     * Initialize the layout system
     */
    init(container) {
        this.container = container;
        this.container.classList.add('split-layout-container');
        
        // Create initial single pane
        this.root = this.createPane();
        this.activePane = this.root;
        this.renderLayout();
        
        // Start observing container for resize
        this.resizeObserver.observe(container);
        
        // Load saved layout if it exists
        this.loadLayout();
    }

    /**
     * Create a new pane
     */
    createPane() {
        const pane = {
            id: `pane-${this.nextPaneId++}`,
            type: 'pane',
            element: null,
            tabs: [],
            activeTabId: null,
            terminalInstance: null
        };
        
        this.panes.set(pane.id, pane);
        return pane;
    }

    /**
     * Create a split container
     */
    createSplit(direction, children, sizes = [50, 50]) {
        return {
            id: `split-${this.nextPaneId++}`,
            type: 'split',
            direction, // 'horizontal' or 'vertical'
            children,
            sizes, // Array of percentages
            element: null
        };
    }

    /**
     * Split a pane in the given direction
     */
    splitPane(paneId, direction, newPaneData = null) {
        const pane = this.panes.get(paneId);
        if (!pane) return null;

        const newPane = this.createPane();
        
        // Copy data to new pane if provided
        if (newPaneData) {
            newPane.tabs = newPaneData.tabs || [];
            newPane.activeTabId = newPaneData.activeTabId;
        }

        // Create split container
        const split = this.createSplit(direction, [pane, newPane]);

        // Update the layout tree
        this.replaceInTree(this.root, pane, split);
        if (this.root === pane) {
            this.root = split;
        }

        this.renderLayout();
        this.saveLayout();
        
        // Notify listeners
        if (this.onPaneCreated) {
            this.onPaneCreated(newPane);
        }
        if (this.onLayoutChanged) {
            this.onLayoutChanged();
        }

        return newPane;
    }

    /**
     * Close a pane and merge its neighbor
     */
    closePane(paneId) {
        const pane = this.panes.get(paneId);
        if (!pane) return false;

        // Don't close the last pane
        if (this.panes.size <= 1) {
            return false;
        }

        // Find parent split
        const parentSplit = this.findParentSplit(this.root, pane);
        if (!parentSplit) {
            // This is the root pane, can't close
            return false;
        }

        // Find sibling
        const siblingIndex = parentSplit.children[0] === pane ? 1 : 0;
        const sibling = parentSplit.children[siblingIndex];

        // Replace parent split with sibling in grandparent
        this.replaceInTree(this.root, parentSplit, sibling);
        if (this.root === parentSplit) {
            this.root = sibling;
        }

        // Clean up
        this.panes.delete(paneId);
        
        // Update active pane if necessary
        if (this.activePane === pane) {
            this.activePane = this.findFirstPane(sibling);
        }

        this.renderLayout();
        this.saveLayout();

        // Notify listeners
        if (this.onPaneRemoved) {
            this.onPaneRemoved(pane);
        }
        if (this.onLayoutChanged) {
            this.onLayoutChanged();
        }

        return true;
    }

    /**
     * Set the active pane
     */
    setActivePane(paneId) {
        const pane = this.panes.get(paneId);
        if (pane && pane !== this.activePane) {
            // Remove active class from previous pane
            if (this.activePane && this.activePane.element) {
                this.activePane.element.classList.remove('active');
            }

            this.activePane = pane;
            
            // Add active class to new pane
            if (pane.element) {
                pane.element.classList.add('active');
            }

            if (this.onPaneActivated) {
                this.onPaneActivated(pane);
            }
        }
    }

    /**
     * Get drop zones for a given position
     */
    getDropZones(x, y) {
        const zones = [];
        
        // Screen edge zones
        const screenRect = this.container.getBoundingClientRect();
        const edgeThreshold = 50;

        // Left edge
        if (x - screenRect.left < edgeThreshold) {
            zones.push({
                type: 'screen-edge',
                direction: 'left',
                rect: {
                    left: screenRect.left,
                    top: screenRect.top,
                    right: screenRect.left + edgeThreshold,
                    bottom: screenRect.bottom
                }
            });
        }

        // Right edge
        if (screenRect.right - x < edgeThreshold) {
            zones.push({
                type: 'screen-edge',
                direction: 'right',
                rect: {
                    left: screenRect.right - edgeThreshold,
                    top: screenRect.top,
                    right: screenRect.right,
                    bottom: screenRect.bottom
                }
            });
        }

        // Top edge
        if (y - screenRect.top < edgeThreshold) {
            zones.push({
                type: 'screen-edge',
                direction: 'top',
                rect: {
                    left: screenRect.left,
                    top: screenRect.top,
                    right: screenRect.right,
                    bottom: screenRect.top + edgeThreshold
                }
            });
        }

        // Bottom edge
        if (screenRect.bottom - y < edgeThreshold) {
            zones.push({
                type: 'screen-edge',
                direction: 'bottom',
                rect: {
                    left: screenRect.left,
                    top: screenRect.bottom - edgeThreshold,
                    right: screenRect.right,
                    bottom: screenRect.bottom
                }
            });
        }

        // Pane-specific zones
        const pane = this.findPaneAtPosition(x, y);
        if (pane && pane.element) {
            const paneRect = pane.element.getBoundingClientRect();
            const centerThreshold = Math.min(paneRect.width, paneRect.height) * 0.3;

            // Center zone for tab merging
            const centerX = paneRect.left + paneRect.width / 2;
            const centerY = paneRect.top + paneRect.height / 2;
            
            if (Math.abs(x - centerX) < centerThreshold && Math.abs(y - centerY) < centerThreshold) {
                zones.push({
                    type: 'pane-center',
                    paneId: pane.id,
                    rect: {
                        left: centerX - centerThreshold,
                        top: centerY - centerThreshold,
                        right: centerX + centerThreshold,
                        bottom: centerY + centerThreshold
                    }
                });
            }

            // Pane edge zones
            const paneEdgeThreshold = 40;
            
            // Left edge
            if (x - paneRect.left < paneEdgeThreshold) {
                zones.push({
                    type: 'pane-edge',
                    paneId: pane.id,
                    direction: 'left',
                    rect: {
                        left: paneRect.left,
                        top: paneRect.top,
                        right: paneRect.left + paneEdgeThreshold,
                        bottom: paneRect.bottom
                    }
                });
            }

            // Right edge
            if (paneRect.right - x < paneEdgeThreshold) {
                zones.push({
                    type: 'pane-edge',
                    paneId: pane.id,
                    direction: 'right',
                    rect: {
                        left: paneRect.right - paneEdgeThreshold,
                        top: paneRect.top,
                        right: paneRect.right,
                        bottom: paneRect.bottom
                    }
                });
            }

            // Top edge
            if (y - paneRect.top < paneEdgeThreshold) {
                zones.push({
                    type: 'pane-edge',
                    paneId: pane.id,
                    direction: 'top',
                    rect: {
                        left: paneRect.left,
                        top: paneRect.top,
                        right: paneRect.right,
                        bottom: paneRect.top + paneEdgeThreshold
                    }
                });
            }

            // Bottom edge
            if (paneRect.bottom - y < paneEdgeThreshold) {
                zones.push({
                    type: 'pane-edge',
                    paneId: pane.id,
                    direction: 'bottom',
                    rect: {
                        left: paneRect.left,
                        top: paneRect.bottom - paneEdgeThreshold,
                        right: paneRect.right,
                        bottom: paneRect.bottom
                    }
                });
            }
        }

        return zones;
    }

    /**
     * Handle tab drop on a zone
     */
    handleTabDrop(tabData, zone) {
        switch (zone.type) {
            case 'screen-edge':
                return this.handleScreenEdgeDrop(tabData, zone);
            case 'pane-edge':
                return this.handlePaneEdgeDrop(tabData, zone);
            case 'pane-center':
                return this.handlePaneCenterDrop(tabData, zone);
            default:
                return false;
        }
    }

    /**
     * Handle drop on screen edge
     */
    handleScreenEdgeDrop(tabData, zone) {
        const direction = zone.direction === 'left' || zone.direction === 'right' ? 'horizontal' : 'vertical';
        
        // Split the root pane
        const newPane = this.createPane();
        const split = this.createSplit(direction, [], [50, 50]);
        
        if (zone.direction === 'left' || zone.direction === 'top') {
            split.children = [newPane, this.root];
        } else {
            split.children = [this.root, newPane];
        }
        
        this.root = split;
        
        // Move tab to new pane
        this.moveTabToPane(tabData, newPane.id);
        
        this.renderLayout();
        this.saveLayout();
        
        if (this.onPaneCreated) {
            this.onPaneCreated(newPane);
        }
        if (this.onLayoutChanged) {
            this.onLayoutChanged();
        }
        
        return true;
    }

    /**
     * Handle drop on pane edge
     */
    handlePaneEdgeDrop(tabData, zone) {
        const targetPane = this.panes.get(zone.paneId);
        if (!targetPane) return false;

        const direction = zone.direction === 'left' || zone.direction === 'right' ? 'horizontal' : 'vertical';
        const newPane = this.splitPane(zone.paneId, direction);
        
        if (!newPane) return false;

        // Move tab to appropriate pane
        const targetPaneId = (zone.direction === 'left' || zone.direction === 'top') ? newPane.id : zone.paneId;
        this.moveTabToPane(tabData, targetPaneId);
        
        return true;
    }

    /**
     * Handle drop on pane center
     */
    handlePaneCenterDrop(tabData, zone) {
        // Move tab to existing pane
        return this.moveTabToPane(tabData, zone.paneId);
    }

    /**
     * Move a tab to a specific pane
     */
    moveTabToPane(tabData, targetPaneId) {
        const targetPane = this.panes.get(targetPaneId);
        if (!targetPane) return false;

        // Remove tab from source pane if it exists
        if (tabData.sourcePaneId) {
            const sourcePane = this.panes.get(tabData.sourcePaneId);
            if (sourcePane) {
                sourcePane.tabs = sourcePane.tabs.filter(tab => tab.id !== tabData.id);
                if (sourcePane.activeTabId === tabData.id) {
                    sourcePane.activeTabId = sourcePane.tabs.length > 0 ? sourcePane.tabs[0].id : null;
                }
            }
        }

        // Add tab to target pane
        targetPane.tabs.push(tabData);
        targetPane.activeTabId = tabData.id;
        
        // Set target pane as active
        this.setActivePane(targetPaneId);
        
        return true;
    }

    /**
     * Render the entire layout
     */
    renderLayout() {
        this.container.innerHTML = '';
        this.renderNode(this.root, this.container);
        this.updatePaneSizes();
    }

    /**
     * Render a single node (pane or split)
     */
    renderNode(node, container) {
        if (node.type === 'pane') {
            this.renderPane(node, container);
        } else if (node.type === 'split') {
            this.renderSplit(node, container);
        }
    }

    /**
     * Render a pane
     */
    renderPane(pane, container) {
        const paneElement = document.createElement('div');
        paneElement.className = 'split-pane';
        paneElement.dataset.paneId = pane.id;
        
        if (pane === this.activePane) {
            paneElement.classList.add('active');
        }

        // Create tab bar
        const tabBar = document.createElement('div');
        tabBar.className = 'pane-tab-bar';
        
        // Create terminal container
        const terminalContainer = document.createElement('div');
        terminalContainer.className = 'pane-terminal-container';
        terminalContainer.id = `terminal-${pane.id}`;

        paneElement.appendChild(tabBar);
        paneElement.appendChild(terminalContainer);
        container.appendChild(paneElement);

        pane.element = paneElement;
        
        // Add click handler to make pane active
        paneElement.addEventListener('click', () => {
            this.setActivePane(pane.id);
        });
    }

    /**
     * Render a split container
     */
    renderSplit(split, container) {
        const splitElement = document.createElement('div');
        splitElement.className = `split-container split-${split.direction}`;
        splitElement.dataset.splitId = split.id;

        for (let i = 0; i < split.children.length; i++) {
            const child = split.children[i];
            const childContainer = document.createElement('div');
            childContainer.className = 'split-child';
            
            // Set size based on split.sizes
            if (split.direction === 'horizontal') {
                childContainer.style.width = `${split.sizes[i]}%`;
            } else {
                childContainer.style.height = `${split.sizes[i]}%`;
            }

            this.renderNode(child, childContainer);
            splitElement.appendChild(childContainer);

            // Add gutter between children (except after last child)
            if (i < split.children.length - 1) {
                const gutter = this.createGutter(split.direction, split.id, i);
                splitElement.appendChild(gutter);
            }
        }

        container.appendChild(splitElement);
        split.element = splitElement;
    }

    /**
     * Create a resizable gutter between panes
     */
    createGutter(direction, splitId, index) {
        const gutter = document.createElement('div');
        gutter.className = `split-gutter split-gutter-${direction}`;
        gutter.dataset.splitId = splitId;
        gutter.dataset.index = index;

        // Add resize handle
        const handle = document.createElement('div');
        handle.className = 'split-gutter-handle';
        gutter.appendChild(handle);

        // Add drag functionality
        let isDragging = false;
        let startPos = 0;
        let startSizes = [];

        const startResize = (e) => {
            isDragging = true;
            startPos = direction === 'horizontal' ? e.clientX : e.clientY;
            
            const split = this.findNodeById(this.root, splitId);
            startSizes = [...split.sizes];
            
            document.addEventListener('mousemove', handleResize);
            document.addEventListener('mouseup', stopResize);
            document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
            e.preventDefault();
        };

        const handleResize = (e) => {
            if (!isDragging) return;

            const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPos - startPos;
            
            const split = this.findNodeById(this.root, splitId);
            const containerRect = split.element.getBoundingClientRect();
            const containerSize = direction === 'horizontal' ? containerRect.width : containerRect.height;
            
            const deltaPercent = (delta / containerSize) * 100;
            
            // Update sizes
            const newSizes = [...startSizes];
            newSizes[index] += deltaPercent;
            newSizes[index + 1] -= deltaPercent;
            
            // Ensure minimum sizes
            const minSize = 10;
            if (newSizes[index] < minSize) {
                newSizes[index + 1] += newSizes[index] - minSize;
                newSizes[index] = minSize;
            }
            if (newSizes[index + 1] < minSize) {
                newSizes[index] += newSizes[index + 1] - minSize;
                newSizes[index + 1] = minSize;
            }
            
            split.sizes = newSizes;
            this.renderLayout();
        };

        const stopResize = () => {
            if (!isDragging) return;
            isDragging = false;
            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', stopResize);
            document.body.style.cursor = '';
            this.saveLayout();
        };

        // Double-click to reset to 50/50
        gutter.addEventListener('dblclick', this.handleGutterDoubleClick);
        gutter.addEventListener('mousedown', startResize);

        return gutter;
    }

    /**
     * Handle double-click on gutter to reset to 50/50
     */
    handleGutterDoubleClick(e) {
        const splitId = e.currentTarget.dataset.splitId;
        const index = parseInt(e.currentTarget.dataset.index);
        
        const split = this.findNodeById(this.root, splitId);
        if (split && split.children.length === 2) {
            split.sizes = [50, 50];
            this.renderLayout();
            this.saveLayout();
        }
    }

    /**
     * Update pane sizes after layout changes
     */
    updatePaneSizes() {
        // Notify all panes to resize their terminals
        this.panes.forEach(pane => {
            if (pane.terminalInstance && pane.element) {
                // Dispatch resize event
                const event = new CustomEvent('pane-resize', {
                    detail: { paneId: pane.id }
                });
                pane.element.dispatchEvent(event);
            }
        });
    }

    /**
     * Handle window resize
     */
    handleResize() {
        this.updatePaneSizes();
    }

    /**
     * Save layout to localStorage
     */
    saveLayout() {
        try {
            const layout = {
                tree: this.serializeNode(this.root),
                activePane: this.activePane ? this.activePane.id : null,
                nextPaneId: this.nextPaneId
            };
            localStorage.setItem('claude-code-split-layout', JSON.stringify(layout));
        } catch (error) {
            console.error('Failed to save layout:', error);
        }
    }

    /**
     * Load layout from localStorage
     */
    loadLayout() {
        try {
            const saved = localStorage.getItem('claude-code-split-layout');
            if (!saved) return;

            const layout = JSON.parse(saved);
            if (layout.tree) {
                this.nextPaneId = layout.nextPaneId || 1;
                this.root = this.deserializeNode(layout.tree);
                
                // Find active pane
                if (layout.activePane) {
                    this.activePane = this.panes.get(layout.activePane) || this.findFirstPane(this.root);
                }
                
                this.renderLayout();
            }
        } catch (error) {
            console.error('Failed to load layout:', error);
        }
    }

    /**
     * Serialize a node for storage
     */
    serializeNode(node) {
        if (node.type === 'pane') {
            return {
                id: node.id,
                type: 'pane'
            };
        } else {
            return {
                id: node.id,
                type: 'split',
                direction: node.direction,
                sizes: node.sizes,
                children: node.children.map(child => this.serializeNode(child))
            };
        }
    }

    /**
     * Deserialize a node from storage
     */
    deserializeNode(data) {
        if (data.type === 'pane') {
            // Ensure the pane ID is tracked
            this.nextPaneId = Math.max(this.nextPaneId, parseInt(data.id.split('-')[1]) + 1);
            
            const pane = {
                id: data.id,
                type: 'pane',
                element: null,
                tabs: [],
                activeTabId: null,
                terminalInstance: null
            };
            this.panes.set(pane.id, pane);
            return pane;
        } else {
            return {
                id: data.id,
                type: 'split',
                direction: data.direction,
                sizes: data.sizes,
                children: data.children.map(child => this.deserializeNode(child)),
                element: null
            };
        }
    }

    // Utility methods
    replaceInTree(root, target, replacement) {
        if (root.type === 'split') {
            for (let i = 0; i < root.children.length; i++) {
                if (root.children[i] === target) {
                    root.children[i] = replacement;
                    return true;
                }
                if (this.replaceInTree(root.children[i], target, replacement)) {
                    return true;
                }
            }
        }
        return false;
    }

    findParentSplit(root, target) {
        if (root.type === 'split') {
            if (root.children.includes(target)) {
                return root;
            }
            for (const child of root.children) {
                const result = this.findParentSplit(child, target);
                if (result) return result;
            }
        }
        return null;
    }

    findFirstPane(root) {
        if (root.type === 'pane') {
            return root;
        } else if (root.type === 'split') {
            return this.findFirstPane(root.children[0]);
        }
        return null;
    }

    findNodeById(root, id) {
        if (root.id === id) return root;
        if (root.type === 'split') {
            for (const child of root.children) {
                const result = this.findNodeById(child, id);
                if (result) return result;
            }
        }
        return null;
    }

    findPaneAtPosition(x, y) {
        for (const pane of this.panes.values()) {
            if (pane.element) {
                const rect = pane.element.getBoundingClientRect();
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    return pane;
                }
            }
        }
        return null;
    }

    /**
     * Get all panes
     */
    getPanes() {
        return Array.from(this.panes.values());
    }

    /**
     * Get active pane
     */
    getActivePane() {
        return this.activePane;
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        window.removeEventListener('resize', this.handleResize);
    }
}

// Export for use in other modules
window.SplitLayout = SplitLayout;