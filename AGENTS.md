# Repository Guidelines

## Project Structure & Module Organization
- bin/cc-web.js: CLI entry; parses flags and starts the server.
- src/server.js: Express + WebSocket server, routes, session wiring.
- src/claude-bridge.js and src/codex-bridge.js: spawn and manage CLI sessions via node-pty.
- src/utils/: helpers (auth token handling, session persistence).
- src/public/: browser UI assets (HTML/JS/CSS) served by the server.
- test/*.test.js: Mocha unit tests for bridges/utilities.

## Build, Test, and Development Commands
- npm install: install dependencies (Node 16+ required).
- npm run dev: start locally with debug logging (equivalent to `node bin/cc-web.js --dev`).
- npm start: start the web server (equivalent to `node bin/cc-web.js`).
- npm test: run Mocha tests in `test/*.test.js`.
Examples:
- Run on a custom port: `node bin/cc-web.js --port 8080`.
- Provide auth token: `node bin/cc-web.js --auth YOUR_TOKEN`.

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Indentation: 2 spaces; use semicolons; prefer single quotes.
- Files: kebab-case for modules (e.g., `claude-bridge.js`), PascalCase for classes, camelCase for functions/variables.
- Tests: name as `*.test.js` colocated under `test/`.
- Linters/formatters: none configured; match existing style and keep diffs minimal.

## Testing Guidelines
- Framework: Mocha with Node’s `assert`.
- Location: `test/` directory; name tests `name.test.js`.
- Running: `npm test`.
- Behavior: write fast, isolated unit tests; avoid network and real CLI calls—mock process spawns where possible. Use temp dirs under `test/` (see `session-store.test.js`). No coverage threshold enforced.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (e.g., `feat:`, `fix:`, `chore(release): vX.Y.Z`, `fix(analytics): …`).
- PRs: concise description, linked issues, and screenshots/GIFs for UI-facing changes. Include reproduction steps and risk notes.
- Tests/docs: add or update tests for behavior changes; update README/API docs when flags, routes, or defaults change.

## Security & Configuration Tips
- Auth: enabled by default. Use `--auth <token>` to set; avoid `--disable-auth` except in local dev. Do not commit or log tokens.
- HTTPS: prefer `--https --cert <path> --key <path>` for production.
- Dependencies: ensure Claude/Code CLI is installed and on PATH; respect `engines.node >= 16`.
