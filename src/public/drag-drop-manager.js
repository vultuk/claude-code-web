/**
 * Drag and Drop Manager
 * Handles dragging tabs and showing drop zones with VS Code-style behavior
 */
class DragDropManager {
    constructor(splitLayout) {
        this.splitLayout = splitLayout;
        this.isDragging = false;
        this.dragData = null;
        this.dragPreview = null;
        this.dropZoneOverlay = null;
        this.currentDropZone = null;
        this.dropZones = [];
        
        // Accessibility
        this.ariaLiveRegion = null;
        
        // Bind methods
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        
        this.init();
    }

    /**
     * Initialize drag and drop system
     */
    init() {
        // Create ARIA live region for accessibility
        this.createAriaLiveRegion();
        
        // Listen for keyboard events (ESC to cancel)
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /**
     * Create ARIA live region for screen reader announcements
     */
    createAriaLiveRegion() {
        this.ariaLiveRegion = document.createElement('div');
        this.ariaLiveRegion.className = 'drag-drop-aria-live';
        this.ariaLiveRegion.setAttribute('aria-live', 'polite');
        this.ariaLiveRegion.setAttribute('aria-atomic', 'true');
        this.ariaLiveRegion.style.cssText = `
            position: absolute;
            left: -10000px;
            width: 1px;
            height: 1px;
            overflow: hidden;
        `;
        document.body.appendChild(this.ariaLiveRegion);
    }

    /**
     * Start dragging a tab
     */
    startDrag(tabData, startEvent) {
        if (this.isDragging) return false;

        this.isDragging = true;
        this.dragData = {
            ...tabData,
            startX: startEvent.clientX,
            startY: startEvent.clientY,
            offsetX: startEvent.offsetX,
            offsetY: startEvent.offsetY
        };

        // Create drag preview
        this.createDragPreview(startEvent);
        
        // Create drop zone overlay
        this.createDropZoneOverlay();
        
        // Add event listeners
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
        
        // Prevent default drag behavior
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        
        // Announce drag start
        this.announceToScreenReader(`Started dragging tab ${tabData.name}`);
        
        return true;
    }

    /**
     * Create visual preview of dragged tab
     */
    createDragPreview(startEvent) {
        this.dragPreview = document.createElement('div');
        this.dragPreview.className = 'drag-preview';
        
        // Create tab preview content
        const tabPreview = document.createElement('div');
        tabPreview.className = 'drag-preview-tab';
        tabPreview.innerHTML = `
            <div class="tab-status ${this.dragData.status}"></div>
            <span class="tab-name">${this.dragData.name}</span>
        `;
        
        this.dragPreview.appendChild(tabPreview);
        document.body.appendChild(this.dragPreview);
        
        // Position preview
        this.updateDragPreview(startEvent.clientX, startEvent.clientY);
    }

    /**
     * Update drag preview position
     */
    updateDragPreview(x, y) {
        if (!this.dragPreview) return;
        
        this.dragPreview.style.left = `${x - this.dragData.offsetX}px`;
        this.dragPreview.style.top = `${y - this.dragData.offsetY}px`;
    }

    /**
     * Create drop zone overlay
     */
    createDropZoneOverlay() {
        this.dropZoneOverlay = document.createElement('div');
        this.dropZoneOverlay.className = 'drop-zone-overlay';
        document.body.appendChild(this.dropZoneOverlay);
    }

    /**
     * Handle mouse move during drag
     */
    handleMouseMove(e) {
        if (!this.isDragging) return;

        // Update drag preview position
        this.updateDragPreview(e.clientX, e.clientY);
        
        // Update drop zones
        this.updateDropZones(e.clientX, e.clientY);
        
        e.preventDefault();
    }

    /**
     * Update drop zones based on mouse position
     */
    updateDropZones(x, y) {
        // Get available drop zones from split layout
        this.dropZones = this.splitLayout.getDropZones(x, y);
        
        // Find active drop zone
        const activeZone = this.findActiveDropZone(x, y);
        
        // Update visual indicators
        this.updateDropZoneVisuals(activeZone);
        
        // Update current zone
        if (activeZone !== this.currentDropZone) {
            this.currentDropZone = activeZone;
            
            // Announce zone change to screen reader
            if (activeZone) {
                this.announceDropZone(activeZone);
            } else {
                this.announceToScreenReader('No drop zone');
            }
        }
    }

    /**
     * Find the active drop zone at given coordinates
     */
    findActiveDropZone(x, y) {
        // Prioritize drop zones by type and size
        const priorityOrder = ['pane-center', 'pane-edge', 'screen-edge'];
        
        for (const type of priorityOrder) {
            const zone = this.dropZones.find(z => 
                z.type === type && 
                this.isPointInRect(x, y, z.rect)
            );
            if (zone) return zone;
        }
        
        return null;
    }

    /**
     * Check if a point is inside a rectangle
     */
    isPointInRect(x, y, rect) {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    /**
     * Update drop zone visual indicators
     */
    updateDropZoneVisuals(activeZone) {
        if (!this.dropZoneOverlay) return;
        
        // Clear existing zones
        this.dropZoneOverlay.innerHTML = '';
        
        if (!activeZone) return;
        
        // Create visual indicator for active zone
        const indicator = document.createElement('div');
        indicator.className = `drop-zone-indicator drop-zone-${activeZone.type}`;
        
        // Set position and size
        const rect = activeZone.rect;
        indicator.style.left = `${rect.left}px`;
        indicator.style.top = `${rect.top}px`;
        indicator.style.width = `${rect.right - rect.left}px`;
        indicator.style.height = `${rect.bottom - rect.top}px`;
        
        // Add direction class for edge zones
        if (activeZone.direction) {
            indicator.classList.add(`drop-zone-${activeZone.direction}`);
        }
        
        // Add preview content
        const preview = document.createElement('div');
        preview.className = 'drop-zone-preview';
        preview.textContent = this.getDropZonePreviewText(activeZone);
        indicator.appendChild(preview);
        
        this.dropZoneOverlay.appendChild(indicator);
    }

    /**
     * Get preview text for drop zone
     */
    getDropZonePreviewText(zone) {
        switch (zone.type) {
            case 'screen-edge':
                return `Split ${zone.direction}`;
            case 'pane-edge':
                return `Split ${zone.direction}`;
            case 'pane-center':
                return 'Add to pane';
            default:
                return 'Drop here';
        }
    }

    /**
     * Handle mouse up (end drag)
     */
    handleMouseUp(e) {
        if (!this.isDragging) return;

        const success = this.completeDrop(e.clientX, e.clientY);
        this.endDrag(success);
        
        e.preventDefault();
    }

    /**
     * Complete the drop operation
     */
    completeDrop(x, y) {
        if (!this.currentDropZone) {
            this.announceToScreenReader('Drop cancelled - no valid drop zone');
            return false;
        }

        // Perform the drop using split layout
        const success = this.splitLayout.handleTabDrop(this.dragData, this.currentDropZone);
        
        if (success) {
            this.announceToScreenReader(`Tab ${this.dragData.name} moved successfully`);
        } else {
            this.announceToScreenReader(`Failed to move tab ${this.dragData.name}`);
        }
        
        return success;
    }

    /**
     * End drag operation
     */
    endDrag(success) {
        this.isDragging = false;
        
        // Remove event listeners
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        
        // Clean up DOM elements
        if (this.dragPreview) {
            // Animate preview away
            if (success) {
                this.animateDragPreviewSuccess();
            } else {
                this.animateDragPreviewCancel();
            }
        }
        
        if (this.dropZoneOverlay) {
            this.dropZoneOverlay.remove();
            this.dropZoneOverlay = null;
        }
        
        // Reset styles
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        
        // Reset state
        this.dragData = null;
        this.currentDropZone = null;
        this.dropZones = [];
    }

    /**
     * Animate drag preview on successful drop
     */
    animateDragPreviewSuccess() {
        if (!this.dragPreview) return;
        
        this.dragPreview.style.transition = 'all 0.2s ease-out';
        this.dragPreview.style.transform = 'scale(0.8)';
        this.dragPreview.style.opacity = '0';
        
        setTimeout(() => {
            if (this.dragPreview) {
                this.dragPreview.remove();
                this.dragPreview = null;
            }
        }, 200);
    }

    /**
     * Animate drag preview on cancelled drop
     */
    animateDragPreviewCancel() {
        if (!this.dragPreview) return;
        
        // Animate back to start position
        this.dragPreview.style.transition = 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
        this.dragPreview.style.left = `${this.dragData.startX - this.dragData.offsetX}px`;
        this.dragPreview.style.top = `${this.dragData.startY - this.dragData.offsetY}px`;
        this.dragPreview.style.transform = 'scale(0.9)';
        this.dragPreview.style.opacity = '0.5';
        
        setTimeout(() => {
            if (this.dragPreview) {
                this.dragPreview.remove();
                this.dragPreview = null;
            }
        }, 300);
    }

    /**
     * Handle keyboard events during drag
     */
    handleKeyDown(e) {
        if (!this.isDragging) return;
        
        if (e.key === 'Escape') {
            this.announceToScreenReader('Drag cancelled');
            this.endDrag(false);
            e.preventDefault();
        }
    }

    /**
     * Announce drop zone to screen reader
     */
    announceDropZone(zone) {
        let announcement = '';
        
        switch (zone.type) {
            case 'screen-edge':
                announcement = `Drop to split ${zone.direction} edge of window`;
                break;
            case 'pane-edge':
                announcement = `Drop to split ${zone.direction} edge of pane`;
                break;
            case 'pane-center':
                announcement = `Drop to add tab to pane`;
                break;
            default:
                announcement = `Drop zone available`;
        }
        
        this.announceToScreenReader(announcement);
    }

    /**
     * Announce message to screen reader
     */
    announceToScreenReader(message) {
        if (this.ariaLiveRegion) {
            this.ariaLiveRegion.textContent = message;
        }
    }

    /**
     * Enable tab dragging for an element
     */
    enableTabDrag(element, tabData) {
        const handleMouseDown = (e) => {
            // Only handle left mouse button
            if (e.button !== 0) return;
            
            // Don't start drag on close button
            if (e.target.classList.contains('tab-close')) return;
            
            e.preventDefault();
            
            // Start drag after small movement to avoid accidental drags
            let hasMoved = false;
            const startX = e.clientX;
            const startY = e.clientY;
            const threshold = 5;
            
            const handleMove = (moveEvent) => {
                const deltaX = Math.abs(moveEvent.clientX - startX);
                const deltaY = Math.abs(moveEvent.clientY - startY);
                
                if (!hasMoved && (deltaX > threshold || deltaY > threshold)) {
                    hasMoved = true;
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                    
                    // Start actual drag
                    this.startDrag(tabData, moveEvent);
                }
            };
            
            const handleUp = () => {
                document.removeEventListener('mousemove', handleMove);
                document.removeEventListener('mouseup', handleUp);
            };
            
            document.addEventListener('mousemove', handleMove);
            document.addEventListener('mouseup', handleUp);
        };
        
        element.addEventListener('mousedown', handleMouseDown);
        element.draggable = false; // Disable native drag
        
        // Store cleanup function
        element._dragCleanup = () => {
            element.removeEventListener('mousedown', handleMouseDown);
        };
    }

    /**
     * Disable tab dragging for an element
     */
    disableTabDrag(element) {
        if (element._dragCleanup) {
            element._dragCleanup();
            delete element._dragCleanup;
        }
    }

    /**
     * Check if currently dragging
     */
    isDraggingTab() {
        return this.isDragging;
    }

    /**
     * Get current drag data
     */
    getDragData() {
        return this.dragData;
    }

    /**
     * Force cancel current drag operation
     */
    cancelDrag() {
        if (this.isDragging) {
            this.endDrag(false);
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.cancelDrag();
        document.removeEventListener('keydown', this.handleKeyDown);
        
        if (this.ariaLiveRegion) {
            this.ariaLiveRegion.remove();
            this.ariaLiveRegion = null;
        }
    }
}

// Export for use in other modules
window.DragDropManager = DragDropManager;