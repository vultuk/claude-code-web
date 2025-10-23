const { spawn } = require('node-pty');
const path = require('path');
const fs = require('fs');

class ClaudeBridge {
  constructor() {
    this.sessions = new Map();
    this.claudeCommand = this.findClaudeCommand();
  }

  findClaudeCommand() {
    const possibleCommands = [
      '/home/ec2-user/.claude/local/claude',
      'claude',
      'claude-code',
      path.join(process.env.HOME || '/', '.claude', 'local', 'claude'),
      path.join(process.env.HOME || '/', '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude'
    ];

    for (const cmd of possibleCommands) {
      try {
        if (fs.existsSync(cmd) || this.commandExists(cmd)) {
          console.log(`Found Claude command at: ${cmd}`);
          return cmd;
        }
      } catch (error) {
        continue;
      }
    }

    console.error('Claude command not found, using default "claude"');
    return 'claude';
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
      console.log(`Starting Claude session ${sessionId}`);
      console.log(`Command: ${this.claudeCommand}`);
      console.log(`Working directory: ${workingDir}`);
      console.log(`Terminal size: ${cols}x${rows}`);
      if (dangerouslySkipPermissions) {
        console.log(`⚠️ WARNING: Skipping permissions with --dangerously-skip-permissions flag`);
      }

      const args = dangerouslySkipPermissions ? ['--dangerously-skip-permissions'] : [];
      const claudeProcess = spawn(this.claudeCommand, args, {
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
        process: claudeProcess,
        workingDir,
        created: new Date(),
        active: true,
        killTimeout: null
      };

      this.sessions.set(sessionId, session);

      // Track if we've seen the trust prompt
      let trustPromptHandled = false;
      let dataBuffer = '';

      claudeProcess.onData((data) => {
        if (process.env.DEBUG) {
          console.log(`Session ${sessionId} output:`, data);
        }
        
        // Buffer data to check for trust prompt
        dataBuffer += data;
        
        // Check for trust prompt and auto-accept it
        if (!trustPromptHandled && dataBuffer.includes('Do you trust the files in this folder?')) {
          trustPromptHandled = true;
          console.log(`Auto-accepting trust prompt for session ${sessionId}`);
          // The prompt shows "Enter to confirm" which means option 1 is already selected
          // Just send Enter to confirm
          setTimeout(() => {
            claudeProcess.write('\r');
            console.log(`Sent Enter to accept trust prompt for session ${sessionId}`);
          }, 500);
        }
        
        // Clear buffer periodically to prevent memory issues
        if (dataBuffer.length > 10000) {
          dataBuffer = dataBuffer.slice(-5000);
        }
        
        onOutput(data);
      });

      claudeProcess.onExit((exitCode, signal) => {
        console.log(`Claude session ${sessionId} exited with code ${exitCode}, signal ${signal}`);
        // Clear kill timeout if process exited naturally
        if (session.killTimeout) {
          clearTimeout(session.killTimeout);
          session.killTimeout = null;
        }
        session.active = false;
        this.sessions.delete(sessionId);
        onExit(exitCode, signal);
      });

      claudeProcess.on('error', (error) => {
        console.error(`Claude session ${sessionId} error:`, error);
        // Clear kill timeout if process errored
        if (session.killTimeout) {
          clearTimeout(session.killTimeout);
          session.killTimeout = null;
        }
        session.active = false;
        this.sessions.delete(sessionId);
        onError(error);
      });

      console.log(`Claude session ${sessionId} started successfully`);
      return session;

    } catch (error) {
      console.error(`Failed to start Claude session ${sessionId}:`, error);
      throw new Error(`Failed to start Claude Code: ${error.message}`);
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
      // Clear any existing kill timeout
      if (session.killTimeout) {
        clearTimeout(session.killTimeout);
        session.killTimeout = null;
      }

      if (session.active && session.process) {
        session.process.kill('SIGTERM');
        
        session.killTimeout = setTimeout(() => {
          if (session.active && session.process) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } catch (error) {
      console.warn(`Error stopping session ${sessionId}:`, error.message);
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

module.exports = ClaudeBridge;