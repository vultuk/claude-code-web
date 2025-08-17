const { spawn } = require('node-pty');
const path = require('path');
const fs = require('fs');

class ClaudeBridge {
  constructor() {
    this.sessions = new Map();
    this.claudeCommand = this.findClaudeCommand();
    this.usageTracker = new Map(); // Track usage per session
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
      require('child_process').execSync(`which ${command}`, { stdio: 'ignore' });
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
        usageData: {
          requests: 0,
          estimatedTokens: 0,
          startTime: Date.now(),
          lastActivity: Date.now(),
          dailyLimit: 30, // Estimated daily request limit
          tokenLimit: 100000, // Estimated token limit
          resetTime: this.getNextResetTime()
        }
      };

      this.sessions.set(sessionId, session);
      this.usageTracker.set(sessionId, session.usageData);

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
        session.active = false;
        this.sessions.delete(sessionId);
        onExit(exitCode, signal);
      });

      claudeProcess.on('error', (error) => {
        console.error(`Claude session ${sessionId} error:`, error);
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
      
      // Update usage tracking when user sends input
      if (session.usageData && data.trim().length > 0) {
        // Detect if this is a command (heuristic: ends with Enter and has content)
        if (data.includes('\r') || data.includes('\n')) {
          session.usageData.requests++;
          session.usageData.estimatedTokens += Math.ceil(data.length / 4); // Rough token estimate
          session.usageData.lastActivity = Date.now();
          
          // Emit usage update
          if (this.onUsageUpdate) {
            this.onUsageUpdate(sessionId, this.getUsageStats(sessionId));
          }
        }
      }
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

  // Usage tracking methods
  getNextResetTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  getUsageStats(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.usageData) {
      return null;
    }

    const usage = session.usageData;
    const now = Date.now();
    
    // Check if we need to reset (new day)
    if (now > usage.resetTime) {
      usage.requests = 0;
      usage.estimatedTokens = 0;
      usage.resetTime = this.getNextResetTime();
      usage.startTime = now;
    }

    const requestPercentage = (usage.requests / usage.dailyLimit) * 100;
    const tokenPercentage = (usage.estimatedTokens / usage.tokenLimit) * 100;
    const timeToReset = usage.resetTime - now;
    
    // Calculate rate and predict when limit will be hit
    const sessionDuration = now - usage.startTime;
    const requestRate = sessionDuration > 0 ? usage.requests / (sessionDuration / 60000) : 0; // requests per minute
    const minutesUntilLimit = requestRate > 0 ? (usage.dailyLimit - usage.requests) / requestRate : Infinity;

    return {
      requests: usage.requests,
      requestLimit: usage.dailyLimit,
      requestPercentage: Math.min(requestPercentage, 100),
      estimatedTokens: usage.estimatedTokens,
      tokenLimit: usage.tokenLimit,
      tokenPercentage: Math.min(tokenPercentage, 100),
      timeToReset,
      minutesUntilLimit: Math.max(0, minutesUntilLimit),
      status: requestPercentage >= 90 ? 'critical' : requestPercentage >= 70 ? 'warning' : 'normal'
    };
  }

  setUsageUpdateCallback(callback) {
    this.onUsageUpdate = callback;
  }
}

module.exports = ClaudeBridge;