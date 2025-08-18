# VS Code-Style Split Tabs & Docking Guide

Claude Code Web now supports VS Code-style tab splitting and docking, allowing you to work with multiple Claude sessions simultaneously in a flexible layout.

## Quick Start

### Creating Splits
- **Drag any tab** to the edges of the screen or existing panes
- **Keyboard shortcuts:**
  - `Ctrl+Shift+E` - Split current pane horizontally (right)
  - `Ctrl+Shift+O` - Split current pane vertically (down)

### Moving Tabs
- **Drag to pane center** - Move tab to that pane (merge)
- **Drag to pane edge** - Create split at that edge
- **Drag to screen edge** - Create split for entire layout

### Managing Panes
- **Resize panes** - Drag the gutter between panes
- **Reset to 50/50** - Double-click any gutter
- **Close pane** - Click X button (only visible when multiple panes exist)
- **Auto-cleanup** - Empty panes automatically close

## Drag & Drop Zones

When dragging a tab, you'll see highlighted drop zones:

### Screen Edge Zones
- **Left/Right edges** - Create horizontal split
- **Top/Bottom edges** - Create vertical split
- **Default ratio** - 50/50 split

### Pane-Specific Zones
- **Center zone** - Add tab to pane (dashed blue border)
- **Edge zones** - Split pane in that direction (solid blue border)

### Visual Feedback
- **Blue highlights** show valid drop zones
- **Preview text** explains what will happen
- **Screen reader** announces zones for accessibility

## Keyboard Navigation

### Tab Management
- `Ctrl+T` - New tab in active pane
- `Ctrl+W` - Close active tab
- `Ctrl+1-9` - Switch to tab by number in active pane

### Pane Navigation
- Click any pane to make it active
- Active pane has blue border
- Only one pane is active at a time

### Drag Operations
- `ESC` - Cancel current drag operation
- Mouse/trackpad drag - Primary interaction
- Touch drag - Full mobile support

## Accessibility Features

### Screen Reader Support
- **Live regions** announce drag operations and drop zones
- **Semantic roles** for tabs (`tablist`, `tab`)
- **Focus management** for keyboard navigation

### Keyboard Accessibility
- **Tab headers** are focusable and keyboard navigable
- **Resize handles** support keyboard adjustment with arrow keys
- **Consistent focus** management across panes

### Visual Accessibility
- **High contrast mode** support with enhanced borders
- **Reduced motion** support disables animations
- **Clear visual indicators** for all interactive elements

## Mobile Support

### Touch Interactions
- **Touch drag** works the same as mouse drag
- **Larger touch targets** on mobile (36x36px minimum)
- **Responsive gutters** are wider on mobile (6px vs 4px)

### Mobile Optimizations
- **Responsive tab sizes** adjust for smaller screens
- **Touch-friendly controls** with adequate spacing
- **Scrollable tab bars** when tabs overflow

## Persistence

### Layout Saving
- **Automatic saving** to localStorage on layout changes
- **Full layout restoration** on page refresh
- **Graceful degradation** if tabs no longer exist

### What's Persisted
- Pane structure and split ratios
- Active tab per pane
- Layout tree hierarchy
- Terminal state (managed per pane)

## Performance Features

### Smooth Operation
- **60fps animations** with requestAnimationFrame
- **Efficient rendering** using CSS transforms
- **Debounced resize** events to prevent thrashing

### Memory Management
- **Automatic cleanup** of unused terminals
- **Event listener management** prevents memory leaks
- **Efficient DOM updates** minimize reflows

## Technical Implementation

### Architecture
- **SplitLayout** - Manages hierarchical pane structure
- **DragDropManager** - Handles drag operations with accessibility
- **PaneManager** - Controls individual panes and terminals
- **Session integration** - Seamless Claude session management

### Browser Support
- Modern browsers with CSS Grid/Flexbox support
- ResizeObserver API for responsive layouts
- Touch events for mobile drag operations
- Pointer events for unified input handling

## Limitations & Trade-offs

### Known Limitations
- **Complex layouts** may be challenging on very small screens
- **Terminal synchronization** requires careful state management
- **Memory usage** increases with multiple terminals

### Performance Considerations
- Each pane maintains its own terminal instance
- Layout calculations run on window resize
- Drag operations create temporary DOM elements

### Accessibility Trade-offs
- Visual drag feedback may not translate perfectly to screen readers
- Complex layouts can be challenging to navigate via keyboard only
- Touch drag may conflict with scroll gestures on some devices

## Troubleshooting

### Common Issues
- **Tabs not dragging** - Ensure you're dragging the tab header, not close button
- **Zones not appearing** - Check that JavaScript is enabled and browser supports required APIs
- **Layout not persisting** - Verify localStorage is available and not blocked
- **Terminal sizing issues** - Try refreshing or manually resizing panes

### Browser Compatibility
- Chrome/Edge: Full support
- Firefox: Full support  
- Safari: Full support (iOS 13+)
- Mobile browsers: Touch drag supported on modern browsers

---

**Need help?** The split layout system is designed to be intuitive - start by dragging any tab to experiment with the different drop zones!