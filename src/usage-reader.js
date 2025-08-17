const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');

class UsageReader {
  constructor() {
    this.claudeProjectsPath = path.join(process.env.HOME, '.claude', 'projects');
    this.cache = null;
    this.cacheTime = null;
    this.cacheTimeout = 30000; // Cache for 30 seconds
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

  async findJsonlFiles() {
    const files = [];
    
    try {
      const projectDirs = await fs.readdir(this.claudeProjectsPath);
      
      for (const projectDir of projectDirs) {
        const projectPath = path.join(this.claudeProjectsPath, projectDir);
        const stat = await fs.stat(projectPath);
        
        if (stat.isDirectory()) {
          const projectFiles = await fs.readdir(projectPath);
          const jsonlFiles = projectFiles.filter(f => f.endsWith('.jsonl'));
          
          for (const jsonlFile of jsonlFiles) {
            files.push(path.join(projectPath, jsonlFile));
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
            
            if (entry.type === 'assistant' && usage) {
              const inputTokens = usage.input_tokens || 0;
              const outputTokens = usage.output_tokens || 0;
              const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
              const cacheReadTokens = usage.cache_read_input_tokens || 0;
              
              // Calculate cost based on model pricing (approximate)
              let totalCost = 0;
              if (model.includes('opus')) {
                // Opus pricing: $15 per million input, $75 per million output
                totalCost = (inputTokens * 0.000015) + (outputTokens * 0.000075);
                // Cache creation: same as input, cache read: 10% of input
                totalCost += (cacheCreationTokens * 0.000015) + (cacheReadTokens * 0.0000015);
              } else if (model.includes('sonnet')) {
                // Sonnet pricing: $3 per million input, $15 per million output
                totalCost = (inputTokens * 0.000003) + (outputTokens * 0.000015);
                totalCost += (cacheCreationTokens * 0.000003) + (cacheReadTokens * 0.0000003);
              } else if (model.includes('haiku')) {
                // Haiku pricing: $0.25 per million input, $1.25 per million output
                totalCost = (inputTokens * 0.00000025) + (outputTokens * 0.00000125);
                totalCost += (cacheCreationTokens * 0.00000025) + (cacheReadTokens * 0.000000025);
              }
              
              entries.push({
                timestamp: entry.timestamp,
                model: model,
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                cacheCreationTokens: cacheCreationTokens,
                cacheReadTokens: cacheReadTokens,
                totalCost: usage.total_cost || totalCost,
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
    stats.totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheCreationTokens;

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
}

module.exports = UsageReader;