# Advanced Session & Token Analytics

## Overview

The Claude Code Web Interface now includes sophisticated session tracking and token analytics that accurately model Claude's 5-hour rolling session window system.

## Key Features

### 1. Rolling Session Windows
- **5-Hour Sessions**: Each session starts with your first message and lasts exactly 5 hours
- **Multiple Sessions**: Can track multiple overlapping sessions simultaneously
- **Automatic Detection**: Identifies session boundaries from usage patterns

### 2. Burn Rate Calculation
- **Real-time Velocity**: Tracks tokens consumed per minute
- **Trend Analysis**: Identifies if consumption is increasing, decreasing, or stable
- **Confidence Scoring**: Provides accuracy levels for predictions (0-100%)
- **Multi-window Analysis**: Uses 5, 10, 15, 30, and 60-minute windows for accuracy

### 3. Token Depletion Predictions
- **Time to Depletion**: Estimates when current session tokens will be exhausted
- **Confidence-based**: Only shows predictions when confidence > 50%
- **Trend Adjustment**: Accounts for velocity trends in predictions

### 4. Plan-Specific Limits

| Plan | Token Limit | Cost Limit | Messages | Detection |
|------|-------------|------------|----------|-----------|
| **Claude Pro** | 19,000 | $18.00 | 250 | Fixed |
| **Claude Max5** | 88,000 | $35.00 | 1,000 | Fixed |
| **Claude Max20** | 220,000 | $140.00 | 2,000 | Fixed |
| **Custom** | P90-based | $50.00 (default) | 250+ | Machine Learning |

### 5. Visual Indicators

#### Burn Rate Indicators
- 🔥🔥🔥 Very high burn rate (>1000 tokens/min)
- 🔥🔥 High burn rate (>500 tokens/min)
- 🔥 Moderate burn rate (>100 tokens/min)
- 📈 Low burn rate (>50 tokens/min)
- 📊 Very low burn rate (<50 tokens/min)

#### Progress Bar Colors
- **Blue**: Normal usage (0-70%)
- **Yellow**: Warning zone (70-90%)
- **Red**: Danger zone (>90%)

## Configuration

### Environment Variables
```bash
# Set your Claude plan type
export CLAUDE_PLAN=claude-pro  # or claude-max5, claude-max20, custom

# Set custom cost limit (for custom plans)
export CLAUDE_COST_LIMIT=50.00

# Set session duration (default 5 hours)
export CLAUDE_SESSION_HOURS=5
```

### Command Line Options
```bash
# Start with specific plan
npm start -- --plan claude-pro

# Custom cost limit
npm start -- --customCostLimit 75.00

# Custom session duration
npm start -- --sessionHours 5
```

## Usage Display

The interface shows comprehensive usage information:

1. **Session Timer**: Shows elapsed time and remaining time in session
2. **Token Count**: Current tokens used / limit (percentage)
3. **Burn Rate**: Tokens per minute with confidence indicator
4. **Cost**: Running cost for the session
5. **Progress Bar**: Visual representation of token usage

### Mobile View
- Compact display optimized for small screens
- Abbreviated time format (2:15/5:00)
- Simplified burn rate display
- Touch-optimized controls

### Desktop View
- Full detailed display
- Extended time format (02:15:30 remaining)
- Depletion predictions with confidence
- Hover tooltips for additional information

## Technical Implementation

### Core Modules

1. **UsageAnalytics** (`src/usage-analytics.js`)
   - Manages session tracking
   - Calculates burn rates
   - Generates predictions
   - Handles plan limits

2. **UsageReader** (`src/usage-reader.js`)
   - Reads JSONL usage files
   - Detects session boundaries
   - Calculates statistics
   - Identifies overlapping sessions

3. **Server Integration** (`src/server.js`)
   - WebSocket updates every 10 seconds
   - Real-time usage tracking
   - Session management
   - Plan configuration

4. **Client Display** (`src/public/app.js`)
   - Dynamic UI updates
   - Progress bar rendering
   - Mobile-responsive design
   - Real-time timer updates

## P90 Analysis for Custom Plans

For users on custom plans, the system uses P90 (90th percentile) analysis:

1. **Historical Analysis**: Examines your past usage patterns
2. **P90 Calculation**: Determines the token count that 90% of your sessions stay under
3. **Confidence Threshold**: 95% accuracy in limit detection
4. **Adaptive Learning**: Improves accuracy over time

## API Endpoints

### Get Current Usage
WebSocket message: `{ type: 'get_usage' }`

Returns:
```json
{
  "sessionStats": { /* current session data */ },
  "dailyStats": { /* 24-hour statistics */ },
  "sessionTimer": { /* timer information */ },
  "analytics": { /* advanced analytics */ },
  "burnRate": { /* burn rate data */ },
  "plan": "claude-pro",
  "limits": { /* plan limits */ }
}
```

## Troubleshooting

### No Burn Rate Showing
- Requires at least 2 data points
- Wait for multiple requests to generate data

### Incorrect Predictions
- Predictions improve with more data
- Check confidence level (shown as emoji)
- Ensure correct plan is configured

### Session Not Detected
- Sessions start with first message
- Look back window is 24 hours
- Check JSONL files in ~/.claude/projects

## Future Enhancements

- Historical session comparison
- Weekly/monthly usage trends
- Cost optimization recommendations
- Multi-user session tracking
- Export usage reports
- Integration with Claude Monitor