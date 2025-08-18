const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');

class UsageReader {
  constructor(sessionDurationHours = 5) {
    this.claudeProjectsPath = path.join(process.env.HOME, '.claude', 'projects');
    this.cache = null;
    this.cacheTime = null;
    this.cacheTimeout = 5000; // Cache for 5 seconds for more real-time updates
    this.sessionDurationHours = sessionDurationHours; // Default 5 hours from first message
    this.sessionCache = new Map(); // Cache for session detection
    this.overlappingSessions = []; // Track overlapping sessions
  }

  async getUsageStats(hoursBack = 24) {
    // Use cache if fresh
    if (this.cache && this.cacheTime && (Date.now() - this.cacheTime < this.cacheTimeout)) {
      return this.cache;
    }

    try {
      const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));
      const entries = await this.readAllEntries(cutoffTime);
      
      // Calculate statistics
      const stats = this.calculateStats(entries, hoursBack);
      
      // Cache the results
      this.cache = stats;
      this.cacheTime = Date.now();
      
      return stats;
    } catch (error) {
      console.error('Error reading usage stats:', error);
      return null;
    }
  }

  async getCurrentSessionStats() {
    try {
      // Use new session logic based on daily boundaries and cascading 5-hour sessions
      const currentSession = await this.getCurrentSession();
      
      if (!currentSession) {
        return null;
      }
      
      // Get all entries for the current day
      const startOfDay = this.getStartOfCurrentDay();
      const allTodayEntries = await this.readAllEntries(startOfDay);
      
      if (allTodayEntries.length === 0) {
        return null;
      }
      
      // Filter entries to only include those in the current session
      const sessionEntries = allTodayEntries.filter(entry => {
        const entryTime = new Date(entry.timestamp);
        return entryTime >= currentSession.startTime && entryTime <= currentSession.endTime;
      });
      
      // Sort entries chronologically
      sessionEntries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Calculate statistics for the current session window
      const stats = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        models: {},
        sessionStartTime: currentSession.startTime.toISOString(),
        lastUpdate: null,
        sessionId: currentSession.sessionId,
        sessionNumber: currentSession.sessionNumber, // Add session number
        isExpired: new Date() > currentSession.endTime,
        remainingTokens: null
      };
      
      // Aggregate session data
      for (const entry of sessionEntries) {
        stats.requests++;
        stats.inputTokens += entry.inputTokens;
        stats.outputTokens += entry.outputTokens;
        stats.cacheCreationTokens += entry.cacheCreationTokens;
        stats.cacheReadTokens += entry.cacheReadTokens;
        stats.totalCost += entry.totalCost;
        stats.lastUpdate = entry.timestamp;
        
        // Track by model
        const model = entry.model || 'unknown';
        if (!stats.models[model]) {
          stats.models[model] = {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0
          };
        }
        
        stats.models[model].requests++;
        stats.models[model].inputTokens += entry.inputTokens;
        stats.models[model].outputTokens += entry.outputTokens;
        stats.models[model].cost += entry.totalCost;
      }
      
      stats.cacheTokens = stats.cacheCreationTokens + stats.cacheReadTokens;
      // Total tokens only includes input and output (matching claude-monitor behavior)
      stats.totalTokens = stats.inputTokens + stats.outputTokens;
      
      return stats;
    } catch (error) {
      console.error('Error reading current session stats:', error);
      return null;
    }
  }

  async getAllTimeUsageStats() {
    try {
      // Read ALL entries from ALL projects (no time cutoff)
      const entries = await this.readAllEntries(new Date(0));
      
      // Calculate statistics for all time
      const stats = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        models: {},
        firstRequest: null,
        lastRequest: null
      };
      
      // Aggregate all data
      for (const entry of entries) {
        stats.requests++;
        stats.inputTokens += entry.inputTokens;
        stats.outputTokens += entry.outputTokens;
        stats.cacheCreationTokens += entry.cacheCreationTokens;
        stats.cacheReadTokens += entry.cacheReadTokens;
        stats.totalCost += entry.totalCost;
        
        // Track first and last request times
        if (!stats.firstRequest || new Date(entry.timestamp) < new Date(stats.firstRequest)) {
          stats.firstRequest = entry.timestamp;
        }
        if (!stats.lastRequest || new Date(entry.timestamp) > new Date(stats.lastRequest)) {
          stats.lastRequest = entry.timestamp;
        }
        
        // Track by model
        const model = entry.model || 'unknown';
        if (!stats.models[model]) {
          stats.models[model] = {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0
          };
        }
        
        stats.models[model].requests++;
        stats.models[model].inputTokens += entry.inputTokens;
        stats.models[model].outputTokens += entry.outputTokens;
        stats.models[model].cost += entry.totalCost;
      }
      
      stats.cacheTokens = stats.cacheCreationTokens + stats.cacheReadTokens;
      // Total tokens only includes input and output (matching claude-monitor behavior)
      stats.totalTokens = stats.inputTokens + stats.outputTokens;
      
      return stats;
    } catch (error) {
      console.error('Error reading all-time usage stats:', error);
      return null;
    }
  }

  async readAllEntries(cutoffTime) {
    const entries = [];
    
    try {
      // Find all JSONL files
      const files = await this.findJsonlFiles();
      
      // Read entries from each file
      for (const file of files) {
        const fileEntries = await this.readJsonlFile(file, cutoffTime);
        entries.push(...fileEntries);
      }
      
      // Sort by timestamp
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      return entries;
    } catch (error) {
      console.error('Error reading entries:', error);
      return [];
    }
  }
  
  async readRecentEntries(cutoffTime) {
    const entries = [];
    
    try {
      // Find only JSONL files modified in the last 24 hours
      const files = await this.findJsonlFiles(true);
      
      // Read entries from each recent file
      for (const file of files) {
        const fileEntries = await this.readJsonlFile(file, cutoffTime);
        entries.push(...fileEntries);
      }
      
      // Sort by timestamp
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      return entries;
    } catch (error) {
      console.error('Error reading recent entries:', error);
      return [];
    }
  }

  async getMostRecentSessionFile() {
    try {
      // Get the current working directory to find the right project folder
      const cwd = process.cwd();
      // Claude uses format: -home-ec2-user-Development-vultuk-claude-code-web
      const projectDirName = cwd.replace(/\//g, '-'); // Keep leading dash
      let projectPath = path.join(this.claudeProjectsPath, projectDirName);
      
      // Check if the project directory exists
      try {
        await fs.access(projectPath);
      } catch (err) {
        console.log(`Project directory not found: ${projectPath}`);
        return null;
      }
      
      // Get all JSONL files in the project directory
      const files = await fs.readdir(projectPath);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      
      if (jsonlFiles.length === 0) {
        return null;
      }
      
      // Get file stats and find the most recently modified
      let mostRecentFile = null;
      let mostRecentTime = 0;
      
      for (const file of jsonlFiles) {
        const filePath = path.join(projectPath, file);
        const stat = await fs.stat(filePath);
        
        if (stat.mtime.getTime() > mostRecentTime) {
          mostRecentTime = stat.mtime.getTime();
          mostRecentFile = filePath;
        }
      }
      
      // Using most recent session file
      return mostRecentFile;
    } catch (error) {
      console.error('Error finding most recent session file:', error);
      return null;
    }
  }
  
  async findJsonlFiles(onlyRecent = false) {
    const files = [];
    
    try {
      const projectDirs = await fs.readdir(this.claudeProjectsPath);
      
      for (const projectDir of projectDirs) {
        const projectPath = path.join(this.claudeProjectsPath, projectDir);
        const stat = await fs.stat(projectPath);
        
        if (stat.isDirectory()) {
          const projectFiles = await fs.readdir(projectPath);
          const jsonlFiles = projectFiles.filter(f => f.endsWith('.jsonl'));
          
          // If onlyRecent is true, only include files modified in the last 24 hours
          for (const jsonlFile of jsonlFiles) {
            const filePath = path.join(projectPath, jsonlFile);
            
            if (onlyRecent) {
              const fileStat = await fs.stat(filePath);
              const hoursSinceModified = (Date.now() - fileStat.mtime.getTime()) / (1000 * 60 * 60);
              
              // Only include files modified in the last 24 hours
              if (hoursSinceModified <= 24) {
                files.push(filePath);
              }
            } else {
              files.push(filePath);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error finding JSONL files:', error);
    }
    
    return files;
  }

  async readJsonlFile(filePath, cutoffTime) {
    const entries = [];
    
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: createReadStream(filePath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        try {
          const entry = JSON.parse(line);
          
          // Filter by timestamp
          if (entry.timestamp && new Date(entry.timestamp) >= cutoffTime) {
            // Extract relevant data - check for usage in both locations
            const usage = entry.usage || (entry.message && entry.message.usage);
            const model = entry.model || (entry.message && entry.message.model) || 'unknown';
            
            // Check if this is an assistant message with usage data
            if ((entry.type === 'assistant' || (entry.message && entry.message.role === 'assistant')) && usage) {
              const inputTokens = usage.input_tokens || 0;
              const outputTokens = usage.output_tokens || 0;
              const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
              const cacheReadTokens = usage.cache_read_input_tokens || 0;
              
              // Calculate cost based on Claude's actual pricing model
              // These prices match Claude's current cost calculations (2025)
              let totalCost = 0;
              if (model.includes('opus')) {
                // Claude 4.1 Opus pricing: $15/$75 per million tokens
                totalCost = (inputTokens * 0.000015) + (outputTokens * 0.000075);
                // Cache costs: creation same as input, read is 10% of input
                totalCost += (cacheCreationTokens * 0.000015) + (cacheReadTokens * 0.0000015);
              } else if (model.includes('sonnet')) {
                // Claude 4.0 Sonnet pricing: $3/$15 per million tokens
                totalCost = (inputTokens * 0.000003) + (outputTokens * 0.000015);
                totalCost += (cacheCreationTokens * 0.000003) + (cacheReadTokens * 0.0000003);
              } else if (model.includes('haiku')) {
                // Claude 3 Haiku pricing (legacy)
                totalCost = (inputTokens * 0.00000025) + (outputTokens * 0.00000125);
                totalCost += (cacheCreationTokens * 0.00000025) + (cacheReadTokens * 0.000000025);
              }
              
              // Use total_cost from usage if available, but check if it's in cents
              let finalCost = totalCost;
              if (usage.total_cost !== undefined) {
                // If total_cost is greater than 1, it's likely in cents
                finalCost = usage.total_cost > 1 ? usage.total_cost / 100 : usage.total_cost;
              }
              
              entries.push({
                timestamp: entry.timestamp,
                model: model,
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                cacheCreationTokens: cacheCreationTokens,
                cacheReadTokens: cacheReadTokens,
                totalCost: finalCost,
                sessionId: entry.sessionId
              });
            }
          }
        } catch (e) {
          // Ignore malformed lines
        }
      });

      rl.on('close', () => {
        resolve(entries);
      });

      rl.on('error', (error) => {
        console.error('Error reading file:', filePath, error);
        resolve(entries);
      });
    });
  }

  calculateStats(entries, hoursBack) {
    if (!entries || entries.length === 0) {
      return {
        requests: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalCost: 0,
        periodHours: hoursBack,
        firstEntry: null,
        lastEntry: null,
        models: {},
        hourlyRate: 0,
        projectedDaily: 0
      };
    }

    const stats = {
      requests: entries.length,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheTokens: 0,  // Combined cache tokens for display
      totalCost: 0,
      periodHours: hoursBack,
      firstEntry: entries[0].timestamp,
      lastEntry: entries[entries.length - 1].timestamp,
      models: {},
      hourlyRate: 0,
      projectedDaily: 0
    };

    // Aggregate data
    for (const entry of entries) {
      stats.inputTokens += entry.inputTokens;
      stats.outputTokens += entry.outputTokens;
      stats.cacheCreationTokens += entry.cacheCreationTokens;
      stats.cacheReadTokens += entry.cacheReadTokens;
      stats.totalCost += entry.totalCost;
      
      // Track by model
      if (!stats.models[entry.model]) {
        stats.models[entry.model] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0
        };
      }
      
      stats.models[entry.model].requests++;
      stats.models[entry.model].inputTokens += entry.inputTokens;
      stats.models[entry.model].outputTokens += entry.outputTokens;
      stats.models[entry.model].cost += entry.totalCost;
    }

    stats.cacheTokens = stats.cacheCreationTokens + stats.cacheReadTokens;
    // Total tokens should only include input and output (not cache creation)
    // This matches Claude's actual token counting
    stats.totalTokens = stats.inputTokens + stats.outputTokens;

    // Calculate rates
    if (entries.length > 0) {
      const actualHours = (new Date(stats.lastEntry) - new Date(stats.firstEntry)) / (1000 * 60 * 60);
      if (actualHours > 0) {
        stats.hourlyRate = stats.requests / actualHours;
        stats.projectedDaily = stats.hourlyRate * 24;
        
        // Calculate burn rate
        stats.tokensPerHour = stats.totalTokens / actualHours;
        stats.costPerHour = stats.totalCost / actualHours;
      }
    }

    // Add percentage calculations based on typical limits
    // These are rough estimates - actual limits vary by plan
    const estimatedDailyLimit = 100; // Rough estimate
    const estimatedTokenLimit = 1000000; // Rough estimate
    
    stats.requestPercentage = (stats.projectedDaily / estimatedDailyLimit) * 100;
    stats.tokenPercentage = ((stats.tokensPerHour * 24) / estimatedTokenLimit) * 100;

    return stats;
  }

  // Get usage for a specific Claude session ID
  async getSessionUsageById(sessionId) {
    try {
      if (!sessionId) {
        return null;
      }
      
      // Find the JSONL file for this session
      const sessionFile = path.join(this.claudeProjectsPath, path.basename(process.cwd()).replace(/[^a-zA-Z0-9-]/g, '-'), `${sessionId}.jsonl`);
      
      // Check if the file exists
      try {
        await fs.access(sessionFile);
      } catch (err) {
        // Session file not found
        return null;
      }
      
      // Read all entries from this session's file
      const entries = await this.readJsonlFile(sessionFile, new Date(0)); // Read all entries
      
      // Calculate session-specific stats
      const sessionStats = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheTokens: 0,
        totalCost: 0,
        models: {},
        sessionId: sessionId,
        lastUpdate: null,
        firstRequestTime: null
      };
      
      // Aggregate all session data
      for (const entry of entries) {
        sessionStats.requests++;
        sessionStats.inputTokens += entry.inputTokens;
        sessionStats.outputTokens += entry.outputTokens;
        sessionStats.cacheCreationTokens += entry.cacheCreationTokens;
        sessionStats.cacheReadTokens += entry.cacheReadTokens;
        sessionStats.totalCost += entry.totalCost;
        sessionStats.lastUpdate = entry.timestamp;
        
        // Track the first request timestamp
        if (!sessionStats.firstRequestTime) {
          sessionStats.firstRequestTime = entry.timestamp;
        }
        
        // Track by model
        const model = entry.model || 'unknown';
        if (!sessionStats.models[model]) {
          sessionStats.models[model] = {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0
          };
        }
        
        sessionStats.models[model].requests++;
        sessionStats.models[model].inputTokens += entry.inputTokens;
        sessionStats.models[model].outputTokens += entry.outputTokens;
        sessionStats.models[model].cost += entry.totalCost;
      }
      
      sessionStats.cacheTokens = sessionStats.cacheCreationTokens + sessionStats.cacheReadTokens;
      // Total tokens should only include input and output
      sessionStats.totalTokens = sessionStats.inputTokens + sessionStats.outputTokens;
      
      return sessionStats;
    } catch (error) {
      console.error('Error getting session usage:', error);
      return null;
    }
  }
  
  // Legacy method - keeping for compatibility
  async getSessionUsage(sessionStartTime) {
    // This method is kept for backward compatibility
    // New implementation uses getSessionUsageById
    return null;
  }

  // Detect overlapping sessions within rolling windows
  async detectOverlappingSessions() {
    try {
      const now = new Date();
      const lookbackHours = this.sessionDurationHours * 2; // Look back twice the session duration
      const cutoff = new Date(now - lookbackHours * 60 * 60 * 1000);
      const entries = await this.readAllEntries(cutoff);
      
      if (entries.length === 0) return [];
      
      // Group entries into sessions based on time gaps
      const sessions = [];
      let currentSession = null;
      
      for (const entry of entries) {
        if (!currentSession) {
          currentSession = {
            startTime: entry.timestamp,
            endTime: new Date(new Date(entry.timestamp).getTime() + this.sessionDurationHours * 60 * 60 * 1000),
            entries: [entry],
            totalTokens: entry.inputTokens + entry.outputTokens,
            totalCost: entry.totalCost
          };
        } else {
          const timeSinceLastEntry = new Date(entry.timestamp) - new Date(currentSession.entries[currentSession.entries.length - 1].timestamp);
          const gapHours = timeSinceLastEntry / (1000 * 60 * 60);
          
          if (gapHours < this.sessionDurationHours) {
            // Part of the same session
            currentSession.entries.push(entry);
            currentSession.totalTokens += entry.inputTokens + entry.outputTokens;
            currentSession.totalCost += entry.totalCost;
          } else {
            // New session
            sessions.push(currentSession);
            currentSession = {
              startTime: entry.timestamp,
              endTime: new Date(new Date(entry.timestamp).getTime() + this.sessionDurationHours * 60 * 60 * 1000),
              entries: [entry],
              totalTokens: entry.inputTokens + entry.outputTokens,
              totalCost: entry.totalCost
            };
          }
        }
      }
      
      if (currentSession) {
        sessions.push(currentSession);
      }
      
      // Find overlapping sessions
      const overlapping = [];
      for (let i = 0; i < sessions.length; i++) {
        for (let j = i + 1; j < sessions.length; j++) {
          const session1 = sessions[i];
          const session2 = sessions[j];
          
          // Check if sessions overlap
          if (new Date(session1.startTime) < new Date(session2.endTime) &&
              new Date(session2.startTime) < new Date(session1.endTime)) {
            overlapping.push({
              session1: session1,
              session2: session2,
              overlapStart: new Date(Math.max(new Date(session1.startTime), new Date(session2.startTime))),
              overlapEnd: new Date(Math.min(new Date(session1.endTime), new Date(session2.endTime)))
            });
          }
        }
      }
      
      this.overlappingSessions = overlapping;
      return sessions;
    } catch (error) {
      console.error('Error detecting overlapping sessions:', error);
      return [];
    }
  }
  
  // Generate a session ID from timestamp
  generateSessionId(timestamp) {
    return `session_${new Date(timestamp).getTime()}`;
  }
  
  // Calculate burn rate for a given time window
  async calculateBurnRate(minutes = 60) {
    try {
      const cutoff = new Date(Date.now() - minutes * 60 * 1000);
      const entries = await this.readRecentEntries(cutoff);
      
      if (entries.length < 2) {
        return { rate: 0, confidence: 0 };
      }
      
      const totalTokens = entries.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
      const duration = (new Date(entries[entries.length - 1].timestamp) - new Date(entries[0].timestamp)) / 1000 / 60;
      
      if (duration === 0) {
        return { rate: 0, confidence: 0 };
      }
      
      const rate = totalTokens / duration; // tokens per minute
      const confidence = Math.min(entries.length / 10, 1); // Higher confidence with more data points
      
      return { rate, confidence, dataPoints: entries.length };
    } catch (error) {
      console.error('Error calculating burn rate:', error);
      return { rate: 0, confidence: 0 };
    }
  }
  
  // Get recent sessions for display
  async getRecentSessions(limit = 5) {
    try {
      const entries = await this.readAllEntries(new Date(Date.now() - (24 * 60 * 60 * 1000)));
      
      // Group by session ID
      const sessions = {};
      for (const entry of entries) {
        const sessionId = entry.sessionId || 'unknown';
        if (!sessions[sessionId]) {
          sessions[sessionId] = {
            sessionId,
            startTime: entry.timestamp,
            endTime: entry.timestamp,
            requests: 0,
            totalTokens: 0,
            cost: 0
          };
        }
        
        sessions[sessionId].endTime = entry.timestamp;
        sessions[sessionId].requests++;
        sessions[sessionId].totalTokens += (entry.inputTokens + entry.outputTokens);
        sessions[sessionId].cost += entry.totalCost;
      }
      
      // Convert to array and sort by end time
      const sessionArray = Object.values(sessions);
      sessionArray.sort((a, b) => new Date(b.endTime) - new Date(a.endTime));
      
      return sessionArray.slice(0, limit);
    } catch (error) {
      console.error('Error getting recent sessions:', error);
      return [];
    }
  }

  // Helper function to get start of current day (midnight)
  getStartOfCurrentDay() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay;
  }

  // Helper function to find all sessions for the current day
  async getDailySessionBoundaries() {
    try {
      const startOfDay = this.getStartOfCurrentDay();
      const endOfDay = new Date(startOfDay);
      endOfDay.setHours(23, 59, 59, 999);
      
      // Get all entries for the current day
      const entries = await this.readAllEntries(startOfDay);
      
      if (entries.length === 0) {
        return [];
      }
      
      // Filter entries to only include today's entries
      const todayEntries = entries.filter(entry => {
        const entryTime = new Date(entry.timestamp);
        return entryTime >= startOfDay && entryTime <= endOfDay;
      });
      
      if (todayEntries.length === 0) {
        return [];
      }
      
      // Sort entries chronologically (oldest first)
      todayEntries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Find session boundaries
      const sessions = [];
      let sessionNumber = 1;
      let currentSessionStart = null;
      let processedEntries = new Set();
      
      for (const entry of todayEntries) {
        if (processedEntries.has(entry.timestamp)) {
          continue;
        }
        
        const entryTime = new Date(entry.timestamp);
        
        // If no current session or this entry is after the current session ends
        if (!currentSessionStart || entryTime >= new Date(currentSessionStart.getTime() + (this.sessionDurationHours * 60 * 60 * 1000))) {
          // Round down to the nearest hour for session start
          const sessionStart = new Date(entryTime);
          sessionStart.setMinutes(0, 0, 0);
          
          // Session ends 5 hours later or at midnight, whichever is earlier
          const sessionEnd = new Date(sessionStart.getTime() + (this.sessionDurationHours * 60 * 60 * 1000));
          const midnightEnd = new Date(endOfDay);
          const actualSessionEnd = sessionEnd > midnightEnd ? midnightEnd : sessionEnd;
          
          sessions.push({
            sessionNumber: sessionNumber,
            startTime: sessionStart,
            endTime: actualSessionEnd,
            sessionId: this.generateSessionId(sessionStart.toISOString())
          });
          
          currentSessionStart = sessionStart;
          sessionNumber++;
          
          // Mark all entries in this session as processed
          for (const e of todayEntries) {
            const eTime = new Date(e.timestamp);
            if (eTime >= sessionStart && eTime <= actualSessionEnd) {
              processedEntries.add(e.timestamp);
            }
          }
        }
      }
      
      return sessions;
    } catch (error) {
      console.error('Error getting daily session boundaries:', error);
      return [];
    }
  }

  // Helper function to find which session is currently active
  async getCurrentSession() {
    try {
      const now = new Date();
      const sessions = await this.getDailySessionBoundaries();
      
      // Find the session that contains the current time
      for (const session of sessions) {
        if (now >= session.startTime && now <= session.endTime) {
          return session;
        }
      }
      
      // No active session found
      return null;
    } catch (error) {
      console.error('Error getting current session:', error);
      return null;
    }
  }
}

module.exports = UsageReader;