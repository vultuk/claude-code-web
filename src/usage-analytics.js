const EventEmitter = require('events');

class UsageAnalytics extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.sessionDurationHours = options.sessionDurationHours || 5;
    this.confidenceThreshold = options.confidenceThreshold || 0.95;
    this.burnRateWindow = options.burnRateWindow || 60; // minutes for burn rate calculation
    this.updateInterval = options.updateInterval || 10000; // 10 seconds
    
    // Plan limits (v3.0.0 updated)
    this.planLimits = {
      'claude-pro': {
        tokens: 19000,
        cost: 18.00,
        messages: 250,
        algorithm: 'fixed'
      },
      'claude-max5': {
        tokens: 88000,
        cost: 35.00,
        messages: 1000,
        algorithm: 'fixed'
      },
      'claude-max20': {
        tokens: 220000,
        cost: 140.00,
        messages: 2000,
        algorithm: 'fixed'
      },
      'custom': {
        tokens: null, // Calculated via P90
        cost: options.customCostLimit || 50.00,
        messages: 250,
        algorithm: 'p90'
      }
    };
    
    // Current plan (can be set by user)
    this.currentPlan = options.plan || 'custom';
    
    // Session tracking
    this.activeSessions = new Map(); // sessionId -> session data
    this.sessionHistory = [];
    this.rollingWindows = new Map(); // Track multiple overlapping windows
    
    // Usage data
    this.recentUsage = []; // Array of {timestamp, tokens, cost, model}
    this.historicalData = [];
    this.p90Limit = null;
    
    // Burn rate tracking
    this.burnRateHistory = [];
    this.currentBurnRate = 0;
    this.velocityTrend = 'stable'; // 'increasing', 'decreasing', 'stable'
    
    // Predictions
    this.depletionTime = null;
    this.depletionConfidence = 0;
  }

  /**
   * Process new usage data point
   */
  addUsageData(data) {
    const entry = {
      timestamp: new Date(),
      tokens: data.tokens || 0,
      inputTokens: data.inputTokens || 0,
      outputTokens: data.outputTokens || 0,
      cacheCreationTokens: data.cacheCreationTokens || 0,
      cacheReadTokens: data.cacheReadTokens || 0,
      cost: data.cost || 0,
      model: data.model || 'unknown',
      sessionId: data.sessionId
    };
    
    this.recentUsage.push(entry);
    
    // Keep only recent data for burn rate (last hour)
    const cutoff = new Date(Date.now() - this.burnRateWindow * 60 * 1000);
    this.recentUsage = this.recentUsage.filter(e => e.timestamp > cutoff);
    
    // Update burn rate
    this.calculateBurnRate();
    
    // Update predictions
    this.updatePredictions();
    
    this.emit('usage-update', entry);
  }

  /**
   * Start or update a session
   */
  startSession(sessionId, startTime = new Date()) {
    const session = {
      id: sessionId,
      startTime: startTime,
      endTime: new Date(startTime.getTime() + this.sessionDurationHours * 60 * 60 * 1000),
      tokens: 0,
      cost: 0,
      messages: 0,
      isActive: true,
      window: 'current'
    };
    
    this.activeSessions.set(sessionId, session);
    this.updateRollingWindows();
    
    this.emit('session-started', session);
    return session;
  }

  /**
   * Update rolling windows for overlapping sessions
   */
  updateRollingWindows() {
    const now = new Date();
    this.rollingWindows.clear();
    
    // Find all sessions that could be active
    const fiveHoursAgo = new Date(now - this.sessionDurationHours * 60 * 60 * 1000);
    
    for (const [id, session] of this.activeSessions) {
      if (session.startTime > fiveHoursAgo) {
        const windowId = `window_${session.startTime.getTime()}`;
        
        if (!this.rollingWindows.has(windowId)) {
          this.rollingWindows.set(windowId, {
            startTime: session.startTime,
            endTime: session.endTime,
            sessions: [],
            totalTokens: 0,
            totalCost: 0,
            remainingTokens: this.getTokenLimit(),
            burnRate: 0
          });
        }
        
        const window = this.rollingWindows.get(windowId);
        window.sessions.push(id);
      }
    }
    
    this.emit('windows-updated', Array.from(this.rollingWindows.values()));
  }

  /**
   * Calculate burn rate with sophisticated analysis
   */
  calculateBurnRate() {
    if (this.recentUsage.length < 2) {
      this.currentBurnRate = 0;
      return;
    }
    
    // Sort by timestamp
    const sorted = [...this.recentUsage].sort((a, b) => a.timestamp - b.timestamp);
    
    // Calculate rates over different time windows
    const rates = [];
    const windows = [5, 10, 15, 30, 60]; // minutes
    
    for (const window of windows) {
      const cutoff = new Date(Date.now() - window * 60 * 1000);
      const windowData = sorted.filter(e => e.timestamp > cutoff);
      
      if (windowData.length >= 2) {
        const duration = (windowData[windowData.length - 1].timestamp - windowData[0].timestamp) / 1000 / 60; // minutes
        const totalTokens = windowData.reduce((sum, e) => sum + e.tokens, 0);
        
        if (duration > 0) {
          rates.push({
            window: window,
            rate: totalTokens / duration,
            weight: Math.min(windowData.length / 10, 1) // Weight by data points
          });
        }
      }
    }
    
    if (rates.length === 0) {
      this.currentBurnRate = 0;
      return;
    }
    
    // Weighted average of rates
    const totalWeight = rates.reduce((sum, r) => sum + r.weight, 0);
    this.currentBurnRate = rates.reduce((sum, r) => sum + r.rate * r.weight, 0) / totalWeight;
    
    // Track burn rate history for trend analysis
    this.burnRateHistory.push({
      timestamp: new Date(),
      rate: this.currentBurnRate
    });
    
    // Keep only last hour of history
    const histCutoff = new Date(Date.now() - 60 * 60 * 1000);
    this.burnRateHistory = this.burnRateHistory.filter(e => e.timestamp > histCutoff);
    
    // Analyze trend
    this.analyzeTrend();
    
    this.emit('burn-rate-updated', {
      rate: this.currentBurnRate,
      trend: this.velocityTrend,
      confidence: this.calculateConfidence()
    });
  }

  /**
   * Analyze velocity trend
   */
  analyzeTrend() {
    if (this.burnRateHistory.length < 5) {
      this.velocityTrend = 'stable';
      return;
    }
    
    // Compare recent rates to older rates
    const mid = Math.floor(this.burnRateHistory.length / 2);
    const oldRates = this.burnRateHistory.slice(0, mid);
    const newRates = this.burnRateHistory.slice(mid);
    
    const oldAvg = oldRates.reduce((sum, e) => sum + e.rate, 0) / oldRates.length;
    const newAvg = newRates.reduce((sum, e) => sum + e.rate, 0) / newRates.length;
    
    const change = (newAvg - oldAvg) / oldAvg;
    
    if (change > 0.15) {
      this.velocityTrend = 'increasing';
    } else if (change < -0.15) {
      this.velocityTrend = 'decreasing';
    } else {
      this.velocityTrend = 'stable';
    }
  }

  /**
   * Update predictions for token depletion
   */
  updatePredictions() {
    const currentSession = this.getCurrentSession();
    if (!currentSession || this.currentBurnRate === 0) {
      this.depletionTime = null;
      this.depletionConfidence = 0;
      return;
    }
    
    const limit = this.getTokenLimit();
    const used = this.getSessionTokens(currentSession.id);
    const remaining = limit - used;
    
    if (remaining <= 0) {
      this.depletionTime = new Date();
      this.depletionConfidence = 1;
      return;
    }
    
    // Calculate time to depletion
    const minutesToDepletion = remaining / this.currentBurnRate;
    this.depletionTime = new Date(Date.now() + minutesToDepletion * 60 * 1000);
    
    // Calculate confidence based on data quality
    this.depletionConfidence = this.calculateConfidence();
    
    // Adjust for trend
    if (this.velocityTrend === 'increasing') {
      // Depletion might happen sooner
      const adjustment = 0.9; // 10% sooner
      const adjustedTime = Date.now() + (this.depletionTime - Date.now()) * adjustment;
      this.depletionTime = new Date(adjustedTime);
    } else if (this.velocityTrend === 'decreasing') {
      // Depletion might happen later
      const adjustment = 1.1; // 10% later
      const adjustedTime = Date.now() + (this.depletionTime - Date.now()) * adjustment;
      this.depletionTime = new Date(adjustedTime);
    }
    
    this.emit('prediction-updated', {
      depletionTime: this.depletionTime,
      confidence: this.depletionConfidence,
      remaining: remaining,
      burnRate: this.currentBurnRate
    });
  }

  /**
   * Calculate confidence score for predictions
   */
  calculateConfidence() {
    let confidence = 0;
    let factors = 0;
    
    // Factor 1: Amount of recent data
    if (this.recentUsage.length > 0) {
      const dataScore = Math.min(this.recentUsage.length / 20, 1);
      confidence += dataScore * 0.3;
      factors++;
    }
    
    // Factor 2: Consistency of burn rate
    if (this.burnRateHistory.length > 3) {
      const rates = this.burnRateHistory.map(e => e.rate);
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      const variance = rates.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / rates.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; // Coefficient of variation
      const consistencyScore = Math.max(0, 1 - cv);
      confidence += consistencyScore * 0.4;
      factors++;
    }
    
    // Factor 3: Trend stability
    const trendScore = this.velocityTrend === 'stable' ? 1 : 0.7;
    confidence += trendScore * 0.3;
    factors++;
    
    return factors > 0 ? confidence / factors : 0;
  }

  /**
   * Get current active session
   */
  getCurrentSession() {
    const now = new Date();
    for (const [id, session] of this.activeSessions) {
      if (session.startTime <= now && session.endTime > now) {
        return session;
      }
    }
    return null;
  }

  /**
   * Get token limit based on plan
   */
  getTokenLimit() {
    const plan = this.planLimits[this.currentPlan];
    
    if (plan.algorithm === 'fixed') {
      return plan.tokens;
    } else if (plan.algorithm === 'p90') {
      // Use P90 if calculated, otherwise use a default
      return this.p90Limit || 100000;
    }
    
    return 100000; // Default fallback
  }

  /**
   * Calculate P90 limit from historical data
   */
  calculateP90Limit(historicalSessions) {
    if (!historicalSessions || historicalSessions.length < 10) {
      return null;
    }
    
    // Extract token counts from sessions
    const tokenCounts = historicalSessions
      .map(s => s.totalTokens)
      .filter(t => t > 0)
      .sort((a, b) => a - b);
    
    if (tokenCounts.length === 0) {
      return null;
    }
    
    // Calculate P90
    const p90Index = Math.floor(tokenCounts.length * 0.9);
    this.p90Limit = tokenCounts[p90Index];
    
    this.emit('p90-calculated', {
      limit: this.p90Limit,
      sampleSize: tokenCounts.length,
      confidence: Math.min(tokenCounts.length / 100, 1)
    });
    
    return this.p90Limit;
  }

  /**
   * Get tokens used in a session
   */
  getSessionTokens(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return 0;
    
    // Sum tokens from usage data for this session
    const sessionData = this.recentUsage.filter(e => e.sessionId === sessionId);
    return sessionData.reduce((sum, e) => sum + e.tokens, 0);
  }

  /**
   * Get comprehensive analytics data
   */
  getAnalytics() {
    const currentSession = this.getCurrentSession();
    
    return {
      currentSession: currentSession ? {
        id: currentSession.id,
        startTime: currentSession.startTime,
        endTime: currentSession.endTime,
        tokens: this.getSessionTokens(currentSession.id),
        remaining: this.getTokenLimit() - this.getSessionTokens(currentSession.id),
        percentUsed: (this.getSessionTokens(currentSession.id) / this.getTokenLimit()) * 100
      } : null,
      
      burnRate: {
        current: this.currentBurnRate,
        trend: this.velocityTrend,
        history: this.burnRateHistory.slice(-10) // Last 10 data points
      },
      
      predictions: {
        depletionTime: this.depletionTime,
        confidence: this.depletionConfidence,
        minutesRemaining: this.depletionTime ? 
          Math.max(0, (this.depletionTime - Date.now()) / 1000 / 60) : null
      },
      
      plan: {
        type: this.currentPlan,
        limits: this.planLimits[this.currentPlan],
        p90Limit: this.p90Limit
      },
      
      windows: Array.from(this.rollingWindows.values()),
      
      activeSessions: Array.from(this.activeSessions.values()).map(s => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        isActive: s.isActive,
        tokens: this.getSessionTokens(s.id)
      }))
    };
  }

  /**
   * Set user's plan type
   */
  setPlan(planType) {
    if (this.planLimits[planType]) {
      this.currentPlan = planType;
      this.updatePredictions();
      this.emit('plan-changed', planType);
    }
  }

  /**
   * Clean up old data
   */
  cleanup() {
    const now = new Date();
    
    // Remove expired sessions
    for (const [id, session] of this.activeSessions) {
      if (session.endTime < now) {
        this.sessionHistory.push(session);
        this.activeSessions.delete(id);
      }
    }
    
    // Keep only last 24 hours of history
    const cutoff = new Date(now - 24 * 60 * 60 * 1000);
    this.sessionHistory = this.sessionHistory.filter(s => s.endTime > cutoff);
  }
}

module.exports = UsageAnalytics;