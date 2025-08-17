# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Web is a web-based interface for the Claude Code CLI that enables browser-based access with multi-session support and real-time streaming capabilities. The application provides a terminal emulator interface through xterm.js with WebSocket communication for real-time interaction.

## Common Commands

```bash
# Install dependencies
npm install

# Start development server (with extra logging)
npm run dev

# Start production server  
npm start

# Start with custom port
npm start -- --port 8080

# Start with authentication
npm start -- --auth your-token

# Start with HTTPS
npm start -- --https --cert cert.pem --key key.pem
```

## Architecture

### Core Components

**Server Layer (src/server.js)**
- Express server handling REST API and WebSocket connections
- Session persistence via SessionStore (saves to ~/.claude-code-web/sessions.json)
- Authentication middleware with rate limiting
- Folder mode for working directory selection
- Auto-save sessions every 30 seconds

**Claude Bridge (src/claude-bridge.js)**
- Manages Claude CLI process spawning using node-pty
- Handles multiple concurrent Claude sessions
- Process lifecycle management (start, stop, resize)
- Output buffering for reconnection support
- Searches for Claude CLI in multiple standard locations

**Session Management**
- Persistent sessions survive server restarts
- Multi-browser support - same session accessible from different devices
- Session data includes: ID, name, working directory, output buffer, creation time
- Sessions auto-save and can be manually deleted

**Client Architecture (src/public/)**
- **app.js**: Main interface controller, terminal setup, WebSocket management
- **session-manager.js**: Session tab UI, notifications, multi-session handling  
- **plan-detector.js**: Detects Claude plan mode and provides approval UI
- **auth.js**: Client-side authentication handling
- **service-worker.js**: PWA support for offline capabilities

### WebSocket Protocol

The application uses WebSocket for real-time bidirectional communication:
- `create_session`: Initialize new Claude session
- `join_session`: Connect to existing session
- `leave_session`: Disconnect without stopping Claude
- `start_claude`: Launch Claude CLI in session
- `input`: Send user input to Claude
- `resize`: Adjust terminal dimensions
- `stop`: Terminate Claude process

### Security Features
- Optional token-based authentication (Bearer token or query parameter)
- Rate limiting (100 requests/minute per IP by default)
- Path validation to prevent directory traversal
- HTTPS support with SSL certificates

## Key Implementation Details

- Claude CLI discovery attempts multiple paths including ~/.claude/local/claude
- Sessions persist to disk at ~/.claude-code-web/sessions.json
- Output buffer maintains last 1000 lines for reconnection
- Terminal uses xterm-256color with full ANSI color support
- Folder browser restricts access to base directory and subdirectories only
- Mobile-responsive design with touch-optimized controls