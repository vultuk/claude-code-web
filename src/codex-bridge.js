const { spawn } = require('node-pty');
const path = require('path');
const fs = require('fs');

class CodexBridge {
  constructor() {
    this.sessions = new Map();
    this.codexCommand = this.findCodexCommand();
  }

  findCodexCommand() {
    const possibleCommands = [
      path.join(process.env.HOME || '/', '.codex', 'local', 'codex'),
      'codex',
      'codex-code',
      path.join(process.env.HOME || '/', '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/usr/bin/codex'
    ];

    for (const cmd of possibleCommands) {
      try {
        if (fs.existsSync(cmd) || this.commandExists(cmd)) {
          console.log(`Found Codex command at: ${cmd}`);
          return cmd;
        }
      } catch (error) {
        continue;
      }
    }

    console.error('Codex command not found, using default "codex"');
    return 'codex';
  }

  commandExists(command) {
    try {
      require('child_process').execFileSync('which', [command], { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async startSession(sessionId, options = {}) {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const {
      workingDir = process.cwd(),
      dangerouslySkipPermissions = false,
      onOutput = () => {},
      onExit = () => {},
      onError = () => {},
      cols = 80,
      rows = 24
    } = options;

    try {
      console.log(`Starting Codex session ${sessionId}`);
      console.log(`Command: ${this.codexCommand}`);
      console.log(`Working directory: ${workingDir}`);
      console.log(`Terminal size: ${cols}x${rows}`);
      if (dangerouslySkipPermissions) {
        console.log(`⚠️ WARNING: Skipping permissions with --dangerously-skip-permissions flag`);
      }

      const args = dangerouslySkipPermissions ? ['--dangerously-skip-permissions'] : [];
      const codexProcess = spawn(this.codexCommand, args, {
        cwd: workingDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
          COLORTERM: 'truecolor'
        },
        cols,
        rows,
        name: 'xterm-color'
      });

      const session = {
        process: codexProcess,
        workingDir,
        created: new Date(),
        active: true
      };

      this.sessions.set(sessionId, session);

      let dataBuffer = '';

      codexProcess.onData((data) => {
        if (process.env.DEBUG) {
          console.log(`Codex session ${sessionId} output:`, data);
        }
        // Keep a small rolling buffer to detect prompts if needed later
        dataBuffer += data;
        if (dataBuffer.length > 10000) {
          dataBuffer = dataBuffer.slice(-5000);
        }
        onOutput(data);
      });

      codexProcess.onExit((exitCode, signal) => {
        console.log(`Codex session ${sessionId} exited with code ${exitCode}, signal ${signal}`);
        session.active = false;
        this.sessions.delete(sessionId);
        onExit(exitCode, signal);
      });

      codexProcess.on('error', (error) => {
        console.error(`Codex session ${sessionId} error:`, error);
        session.active = false;
        this.sessions.delete(sessionId);
        onError(error);
      });

      console.log(`Codex session ${sessionId} started successfully`);
      return session;

    } catch (error) {
      console.error(`Failed to start Codex session ${sessionId}:`, error);
      throw new Error(`Failed to start Codex Code: ${error.message}`);
    }
  }

  async sendInput(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    try {
      session.process.write(data);
    } catch (error) {
      throw new Error(`Failed to send input to session ${sessionId}: ${error.message}`);
    }
  }

  async resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    try {
      session.process.resize(cols, rows);
    } catch (error) {
      console.warn(`Failed to resize session ${sessionId}:`, error.message);
    }
  }

  async stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      if (session.active && session.process) {
        session.process.kill('SIGTERM');
        setTimeout(() => {
          if (session.active && session.process) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } catch (error) {
      console.warn(`Error stopping codex session ${sessionId}:`, error.message);
    }

    session.active = false;
    this.sessions.delete(sessionId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getAllSessions() {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      workingDir: session.workingDir,
      created: session.created,
      active: session.active
    }));
  }

  async cleanup() {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.stopSession(sessionId);
    }
  }
}

module.exports = CodexBridge;

