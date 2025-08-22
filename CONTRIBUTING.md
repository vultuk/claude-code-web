# Contributing to Claude Code Web

Thanks for your interest in contributing! This guide summarizes how to set up the project, run it locally, write tests, and open high‑quality pull requests.

## Project Structure

- `bin/cc-web.js`: CLI entry; parses flags and starts the server.
- `src/server.js`: Express + WebSocket server, routes, session wiring.
- `src/claude-bridge.js` and `src/codex-bridge.js`: spawn and manage CLI sessions via `node-pty`.
- `src/utils/*`: helpers (auth token handling, session persistence).
- `src/public/*`: browser UI assets (HTML/JS/CSS) served by the server.
- `test/*.test.js`: Mocha unit tests for bridges/utilities.

## Prerequisites

- Node.js >= 16
- Claude/Code CLI installed and available on `PATH`

## Getting Started

```bash
git clone <repository>
cd claude-code-web
npm install
npm run dev           # or: npm start
```

- Dev mode: `npm run dev` (equivalent to `node bin/cc-web.js --dev`).
- Normal mode: `npm start` (equivalent to `node bin/cc-web.js`).
- Custom port: `node bin/cc-web.js --port 8080`.
- Auth token: `node bin/cc-web.js --auth <token>`.

## Testing

- Framework: Mocha with Node’s `assert`.
- Location: `test/` directory; name tests as `*.test.js`.
- Run: `npm test`.
- Guidelines:
  - Write fast, isolated unit tests.
  - Avoid network and real CLI calls — mock process spawns where possible.
  - Use temp dirs under `test/` (see `session-store.test.js`).

## Coding Style

- Language: Node.js (CommonJS).
- Indentation: 2 spaces; use semicolons; prefer single quotes.
- File naming: kebab‑case for modules, PascalCase for classes, camelCase for functions/variables.
- No linters/formatters are configured; match existing style and keep diffs minimal.

## Commit Messages

Follow Conventional Commits. Examples:

- `feat: add multi-session persistence`  
- `fix(auth): do not log tokens`  
- `chore(release): v2.1.0`

## Pull Requests

- Keep PRs focused and narrowly scoped.
- Provide a concise description, reproduction steps, and risk/impact notes.
- Add or update tests for behavior changes.
- Update README/docs when flags, routes, or defaults change.
- Include screenshots/GIFs for UI-facing changes.

## Security & Configuration

- Auth is enabled by default. Use `--auth <token>` to set a token.
- Avoid `--disable-auth` except in local dev; never commit or log tokens.
- Prefer HTTPS in production: `--https --cert <path> --key <path>`.

## Issue Reporting

When filing an issue, include:

- Environment (OS, Node version, browser).
- Exact command(s) run and flags used.
- Expected vs. actual behavior and any logs (omit sensitive info).

## Release Notes

We maintain a `CHANGELOG.md`. If your PR introduces user‑visible changes, please add an entry under the “Unreleased” section following Keep a Changelog style.

## Releasing

Main is protected. All releases must go through a pull request from a separate branch. The automated workflow will tag, create a GitHub release, and publish to npm after merge.

1. Ensure a clean working tree (`git status` is empty) and you are on `main` synced with origin.
2. Run the release helper to prepare a PR (defaults to a patch bump):

   - Patch: `npm run release:pr`
   - Minor: `BUMP=minor npm run release:pr`
   - Major: `BUMP=major npm run release:pr`

   This will:
   - Bump the version in package files (no tag)
   - Ensure `CHANGELOG.md` has an entry for the new version
   - Create `release/vX.Y.Z` branch, commit, push, and open a PR

3. Review the PR, ensure CHANGELOG and notes are correct, then merge.
4. On merge to `main`, the GitHub Actions workflow `.github/workflows/release-on-main.yml` will:
   - Create a tag `vX.Y.Z` and a GitHub Release
   - Publish the package to npm (requires `NPM_TOKEN` secret)

Notes:
- Never push directly to `main`. Branch protection will reject such pushes.
- Ensure `secrets.NPM_TOKEN` is configured at the repository level for publishing.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see `LICENSE`).
