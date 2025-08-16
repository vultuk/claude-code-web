class PlanDetector {
    constructor() {
        this.isMonitoring = false;
        this.outputBuffer = [];
        this.planModeActive = false;
        this.currentPlan = null;
        this.planStartMarker = '## Implementation Plan:';
        this.planEndMarker = 'User has approved your plan';
        this.maxBufferSize = 10000;
        this.onPlanDetected = null;
        this.onPlanModeChange = null;
    }

    processOutput(data) {
        if (!this.isMonitoring) return;

        // Add to buffer
        this.outputBuffer.push({
            timestamp: Date.now(),
            data: data
        });

        // Keep buffer size manageable
        if (this.outputBuffer.length > this.maxBufferSize) {
            this.outputBuffer = this.outputBuffer.slice(-this.maxBufferSize / 2);
        }

        // Convert buffer to text for analysis
        const recentText = this.getRecentText();

        // Check for plan mode activation
        if (!this.planModeActive && this.detectPlanModeStart(recentText)) {
            this.planModeActive = true;
            if (this.onPlanModeChange) {
                this.onPlanModeChange(true);
            }
        }

        // Check for completed plan
        if (this.planModeActive && this.detectCompletedPlan(recentText)) {
            const plan = this.extractPlan(recentText);
            if (plan) {
                this.currentPlan = plan;
                if (this.onPlanDetected) {
                    this.onPlanDetected(plan);
                }
            }
        }

        // Check for plan mode exit
        if (this.planModeActive && this.detectPlanModeEnd(recentText)) {
            this.planModeActive = false;
            if (this.onPlanModeChange) {
                this.onPlanModeChange(false);
            }
        }
    }

    getRecentText(maxChars = 50000) {
        // Get recent output as text, stripping ANSI codes
        const text = this.outputBuffer
            .map(item => item.data)
            .join('')
            .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
            .replace(/\x1b\[[0-9]*[A-Za-z]/g, ''); // Remove other ANSI sequences

        return text.slice(-maxChars);
    }

    detectPlanModeStart(text) {
        // Look for plan mode activation indicators
        const indicators = [
            'Plan mode is active',
            'you MUST NOT make any edits',
            'present your plan by calling the ExitPlanMode tool',
            'Starting plan mode'
        ];

        return indicators.some(indicator => text.includes(indicator));
    }

    detectCompletedPlan(text) {
        // Check if a plan has been presented
        const planPatterns = [
            /## Implementation Plan:/,
            /### \d+\. /,
            /## Plan:/,
            /### Plan Overview/,
            /## Proposed Solution:/
        ];

        // Must have plan content and be recent
        const hasPattern = planPatterns.some(pattern => pattern.test(text));
        const recentText = text.slice(-10000);
        
        return hasPattern && recentText.includes('###');
    }

    extractPlan(text) {
        // Try multiple extraction strategies
        let plan = null;

        // Strategy 1: Look for ## Implementation Plan: to next terminal prompt
        const implMatch = text.match(/## Implementation Plan:[\s\S]*?(?=(?:User has approved|Exit plan mode|[$>]|^[a-z]+@))/i);
        if (implMatch) {
            plan = implMatch[0];
        }

        // Strategy 2: Look for structured plan with ### sections
        if (!plan) {
            const structuredMatch = text.match(/##[^#].*?Plan.*?:[\s\S]*?(?:###.*?[\s\S]*?){2,}(?=(?:User has approved|Exit plan mode|[$>]|^[a-z]+@))/i);
            if (structuredMatch) {
                plan = structuredMatch[0];
            }
        }

        // Strategy 3: Look for recent plan-like content
        if (!plan) {
            const recentText = text.slice(-5000);
            const planMatch = recentText.match(/(?:##|Plan:)[\s\S]*?(?:###[\s\S]*?){1,}/);
            if (planMatch) {
                plan = planMatch[0];
            }
        }

        if (plan) {
            // Clean up the plan text
            plan = plan
                .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI codes
                .replace(/\r\n/g, '\n') // Normalize line endings
                .replace(/\r/g, '\n')
                .trim();

            return {
                content: plan,
                timestamp: Date.now(),
                raw: plan
            };
        }

        return null;
    }

    detectPlanModeEnd(text) {
        const endIndicators = [
            'User has approved your plan',
            'You can now start coding',
            'Plan mode exited',
            'Exiting plan mode'
        ];

        return endIndicators.some(indicator => text.includes(indicator));
    }

    startMonitoring() {
        this.isMonitoring = true;
        this.outputBuffer = [];
        this.planModeActive = false;
        this.currentPlan = null;
    }

    stopMonitoring() {
        this.isMonitoring = false;
        this.outputBuffer = [];
        this.planModeActive = false;
        this.currentPlan = null;
    }

    clearBuffer() {
        this.outputBuffer = [];
        this.currentPlan = null;
    }

    getPlanModeStatus() {
        return this.planModeActive;
    }

    getCurrentPlan() {
        return this.currentPlan;
    }
}

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlanDetector;
}