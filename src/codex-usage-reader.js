const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const readline = require('readline');

/**
 * CodexUsageReader
 *
 * Reads Codex CLI session logs under ~/.codex/sessions and approximates
 * token usage and cost. Codex JSONL does not expose usage directly, so we
 * estimate tokens as chars/4 for user (input) and assistant (output) text.
 *
 * Pricing (approximate, per 1M tokens):
 *  - GPT-5 input:  $1.25
 *  - GPT-5 output: $10.00
 *
 * These are applied to the estimated token counts.
 */
class CodexUsageReader {
  constructor(options = {}) {
    this.sessionsRoot = path.join(process.env.HOME || '/', '.codex', 'sessions');
    // Defaults to GPT-5 since codex-bridge starts with -m gpt-5
    this.model = options.model || 'gpt-5';
    // Pricing per token
    this.inputPricePerToken = options.inputPricePerToken || (1.25 / 1_000_000);
    this.outputPricePerToken = options.outputPricePerToken || (10.0 / 1_000_000);
  }

  // Public: usage since N hours back (default 24)
  async getUsageStats(hoursBack = 24) {
    try {
      const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
      const files = await this.findJsonlFilesSince(cutoff);
      if (files.length === 0) {
        return this.emptyStats();
      }

      let inputChars = 0;
      let outputChars = 0;
      let requests = 0;
      let firstTs = null;
      let lastTs = null;

      for (const file of files) {
        const res = await this.readJsonlApprox(file, cutoff);
        inputChars += res.inputChars;
        outputChars += res.outputChars;
        requests += res.requests;
        if (res.firstTs && (!firstTs || res.firstTs < firstTs)) firstTs = res.firstTs;
        if (res.lastTs && (!lastTs || res.lastTs > lastTs)) lastTs = res.lastTs;
      }

      const inputTokens = this.charsToTokens(inputChars);
      const outputTokens = this.charsToTokens(outputChars);
      const totalTokens = inputTokens + outputTokens;
      const totalCost = (inputTokens * this.inputPricePerToken) + (outputTokens * this.outputPricePerToken);

      const stats = {
        provider: 'codex',
        model: this.model,
        requests,
        inputTokens,
        outputTokens,
        totalTokens,
        totalCost,
        firstEntry: firstTs ? new Date(firstTs).toISOString() : null,
        lastEntry: lastTs ? new Date(lastTs).toISOString() : null,
        // model map mirrors UsageReader structure
        models: {
          [this.model]: {
            requests,
            inputTokens,
            outputTokens,
            cost: totalCost
          }
        }
      };
      return stats;
    } catch (err) {
      // Fail closed; never throw to callers
      return this.emptyStats();
    }
  }

  emptyStats() {
    return {
      provider: 'codex',
      model: this.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      firstEntry: null,
      lastEntry: null,
      models: { [this.model]: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 } }
    };
  }

  charsToTokens(chars) {
    // Rough heuristic: ~4 chars per token
    return Math.ceil((chars || 0) / 4);
  }

  async findJsonlFilesSince(cutoff) {
    const files = [];
    try {
      if (!fs.existsSync(this.sessionsRoot)) return files;

      // Iterate days between cutoff and now; limit to 7 days for safety
      const now = new Date();
      const days = Math.max(1, Math.min(7, Math.ceil((now - cutoff) / (24 * 60 * 60 * 1000))));
      for (let i = 0; i < days; i++) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000);
        const y = String(d.getFullYear());
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dayDir = path.join(this.sessionsRoot, y, m, dd);
        try {
          const entries = await fsp.readdir(dayDir);
          for (const name of entries) {
            if (name.endsWith('.jsonl')) {
              const full = path.join(dayDir, name);
              const stat = await fsp.stat(full);
              if (stat.mtime >= cutoff) files.push(full);
            }
          }
        } catch (_) {
          // ignore missing day directory
        }
      }
    } catch (_) {
      // ignore errors
    }
    return files;
  }

  async readJsonlApprox(filePath, cutoff) {
    return new Promise((resolve) => {
      let inputChars = 0;
      let outputChars = 0;
      let requests = 0;
      let firstTs = null;
      let lastTs = null;

      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        try {
          const obj = JSON.parse(line);
          // Timestamp filter
          let ts = null;
          if (obj.timestamp) ts = new Date(obj.timestamp).getTime();
          if (ts && cutoff && ts < cutoff.getTime()) return;

          if (ts) {
            if (!firstTs || ts < firstTs) firstTs = ts;
            if (!lastTs || ts > lastTs) lastTs = ts;
          }

          if (obj.type === 'message' && obj.role && Array.isArray(obj.content)) {
            // Aggregate input_text for user
            if (obj.role === 'user') {
              for (const part of obj.content) {
                if (part && part.type === 'input_text' && typeof part.text === 'string') {
                  inputChars += part.text.length;
                }
              }
            }
            // Aggregate output_text for assistant and count as a request
            if (obj.role === 'assistant') {
              let sawOutput = false;
              for (const part of obj.content) {
                if (part && (part.type === 'output_text' || part.type === 'input_text') && typeof part.text === 'string') {
                  // Some logs mirror text in input_text too; treat any assistant text as output
                  outputChars += part.text.length;
                  sawOutput = true;
                }
              }
              if (sawOutput) requests += 1;
            }
          }
        } catch (_) {
          // Ignore malformed lines
        }
      });

      rl.on('close', () => {
        resolve({ inputChars, outputChars, requests, firstTs, lastTs });
      });

      rl.on('error', () => {
        resolve({ inputChars: 0, outputChars: 0, requests: 0, firstTs: null, lastTs: null });
      });
    });
  }
}

module.exports = CodexUsageReader;

