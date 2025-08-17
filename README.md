# Claude Code Web Interface

A web-based interface for Claude Code CLI that can be accessed from any browser. This package allows you to run Claude Code in a terminal-like environment through your web browser, with real-time streaming and full interactivity.

## Features

- 🌐 **Web-based terminal** - Access Claude Code from any browser
- 🚀 **Real-time streaming** - Live output with WebSocket communication  
- 🎨 **Terminal emulation** - Full ANSI color support and terminal features
- 🔐 **Authentication** - Optional token-based security
- 📱 **Responsive design** - Works on desktop and mobile
- ⚡ **NPX support** - Run anywhere with `npx claude-code-web`
- 🎛️ **Customizable** - Adjustable font size, themes, and settings
- 🔄 **Multi-Session Support** - Create and manage multiple persistent Claude sessions
- 🌍 **Multi-Browser Access** - Connect to the same session from different browsers/devices
- 💾 **Session Persistence** - Sessions remain active even when disconnecting
- 📜 **Output Buffering** - Reconnect and see previous output from your session

## Installation

### Global Installation
```bash
npm install -g claude-code-web
```

### NPX (No installation required)
```bash
npx claude-code-web
```

## Usage

### Basic Usage
```bash
# Start with default settings (port 3000, max20 plan)
npx claude-code-web

# Specify a subscription plan
npx claude-code-web --plan pro    # 19k tokens, $18 limit
npx claude-code-web --plan max5   # 88k tokens, $35 limit  
npx claude-code-web --plan max20  # 220k tokens, $140 limit (default)

# Specify a custom port
npx claude-code-web --port 8080

# Don't automatically open browser
npx claude-code-web --no-open
```

### With Authentication
```bash
# Use authentication token for secure access
npx claude-code-web --auth your-secret-token

# Access with token in URL: http://localhost:3000/?token=your-secret-token
```

### HTTPS Support
```bash
# Enable HTTPS (requires SSL certificate files)
npx claude-code-web --https --cert /path/to/cert.pem --key /path/to/key.pem
```

### Development Mode
```bash
# Enable additional logging and debugging
npx claude-code-web --dev
```

## Multi-Session Features

### Creating and Managing Sessions
- **Session Dropdown**: Click "Sessions" in the header to view all active sessions
- **New Session**: Create named sessions with custom working directories
- **Join Session**: Connect to any existing session from any browser
- **Leave Session**: Disconnect without stopping the Claude process
- **Delete Session**: Stop Claude and remove the session

### Session Persistence
- Sessions remain active even after all browsers disconnect
- Reconnect from any device using the same server
- Output history preserved (last 1000 lines)
- Multiple users can connect to the same session simultaneously

### Use Cases
- **Remote Work**: Start a session at work, continue from home
- **Collaboration**: Share a session with team members
- **Device Switching**: Move between desktop and mobile seamlessly
- **Recovery**: Never lose work due to connection issues

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Server port | 3000 |
| `--no-open` | Don't automatically open browser | false |
| `--auth <token>` | Authentication token | none |
| `--https` | Enable HTTPS | false |
| `--cert <path>` | SSL certificate file path | none |
| `--key <path>` | SSL private key file path | none |
| `--dev` | Development mode with extra logging | false |

## How It Works

1. **Claude Code Bridge** - Spawns and manages Claude Code processes using `node-pty`
2. **WebSocket Communication** - Real-time bidirectional communication between browser and CLI
3. **Terminal Emulation** - Uses `xterm.js` for full terminal experience with ANSI colors
4. **Process Management** - Handles multiple sessions, process lifecycle, and cleanup
5. **Session Persistence** - Automatically saves and restores sessions across server restarts
6. **Folder Mode** - Browse and select working directories through the web interface
7. **Security** - Optional authentication and rate limiting for production use

## API Endpoints

### REST API
- `GET /` - Web interface
- `GET /api/health` - Server health status
- `GET /api/config` - Get server configuration
- `GET /api/sessions/list` - List all active Claude sessions
- `GET /api/sessions/persistence` - Get session persistence info
- `POST /api/sessions/create` - Create a new session
- `GET /api/sessions/:sessionId` - Get session details
- `DELETE /api/sessions/:sessionId` - Delete a session
- `GET /api/folders` - List available folders (folder mode)
- `POST /api/folders/select` - Select working directory
- `POST /api/set-working-dir` - Set working directory
- `POST /api/create-folder` - Create new folder
- `POST /api/close-session` - Close a session

### WebSocket Events
- `create_session` - Create a new Claude session
- `join_session` - Join an existing session
- `leave_session` - Leave current session
- `start_claude` - Start Claude Code in current session
- `input` - Send input to Claude Code
- `resize` - Resize terminal
- `stop` - Stop Claude Code session
- `ping/pong` - Heartbeat

## Security Considerations

### Authentication
When using the `--auth` option, clients must provide the token either:
- In the `Authorization` header: `Bearer your-token`
- As a query parameter: `?token=your-token`

### Rate Limiting
Built-in rate limiting prevents abuse:
- 100 requests per minute per IP by default
- Configurable limits for production environments

### HTTPS
For production use, enable HTTPS with valid SSL certificates:
```bash
npx claude-code-web --https --cert cert.pem --key key.pem --auth $(openssl rand -hex 32)
```

## Development

### Local Development
```bash
git clone <repository>
cd claude-code-web
npm install
npm run dev
```

### File Structure
```
claude-code-web/
├── bin/cc-web.js          # CLI entry point
├── src/
│   ├── server.js          # Express server + WebSocket
│   ├── claude-bridge.js   # Claude Code process management  
│   ├── utils/
│   │   ├── auth.js        # Authentication utilities
│   │   └── session-store.js # Session persistence
│   └── public/            # Web interface files
│       ├── index.html     # Main HTML
│       ├── app.js         # Frontend JavaScript
│       ├── session-manager.js # Session management UI
│       ├── plan-detector.js # Plan mode detection
│       └── style.css      # Styling
└── package.json
```

## Browser Compatibility

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Requirements

- Node.js 16.0.0 or higher
- Claude Code CLI installed and accessible in PATH
- Modern web browser with WebSocket support

## Troubleshooting

### Claude Code Not Found
Ensure Claude Code is installed and accessible:
```bash
which claude
# or
claude --version
```

### Connection Issues
- Check firewall settings for the specified port
- Verify Claude Code is properly installed
- Try running with `--dev` flag for detailed logs

### Permission Issues
- Ensure the process has permission to spawn child processes
- Check file system permissions for the working directory

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines and submit pull requests to the main repository.

## Support

For issues and feature requests, please use the GitHub issue tracker.