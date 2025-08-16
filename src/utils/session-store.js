const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class SessionStore {
    constructor() {
        // Store sessions in user's home directory
        this.storageDir = path.join(os.homedir(), '.claude-code-web');
        this.sessionsFile = path.join(this.storageDir, 'sessions.json');
        this.initializeStorage();
    }

    async initializeStorage() {
        try {
            // Create storage directory if it doesn't exist
            await fs.mkdir(this.storageDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create storage directory:', error);
        }
    }

    async saveSessions(sessions) {
        try {
            // Convert Map to array for JSON serialization
            const sessionsArray = Array.from(sessions.entries()).map(([id, session]) => ({
                id,
                name: session.name,
                created: session.created,
                lastActivity: session.lastActivity,
                workingDir: session.workingDir,
                active: false, // Always set to false when saving (processes won't persist)
                outputBuffer: session.outputBuffer.slice(-100), // Keep last 100 lines
                connections: [], // Clear connections (they won't persist)
                lastAccessed: session.lastAccessed || Date.now()
            }));

            const data = {
                version: '1.0',
                savedAt: new Date().toISOString(),
                sessions: sessionsArray
            };

            await fs.writeFile(this.sessionsFile, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Failed to save sessions:', error);
            return false;
        }
    }

    async loadSessions() {
        try {
            // Check if sessions file exists
            await fs.access(this.sessionsFile);
            
            const data = await fs.readFile(this.sessionsFile, 'utf8');
            const parsed = JSON.parse(data);
            
            // Check if data is recent (within last 7 days)
            const savedAt = new Date(parsed.savedAt);
            const now = new Date();
            const daysSinceSave = (now - savedAt) / (1000 * 60 * 60 * 24);
            
            if (daysSinceSave > 7) {
                console.log('Sessions are too old, starting fresh');
                return new Map();
            }

            // Convert array back to Map
            const sessions = new Map();
            for (const session of parsed.sessions) {
                // Restore session with default values for runtime properties
                sessions.set(session.id, {
                    ...session,
                    created: new Date(session.created),
                    lastActivity: new Date(session.lastActivity),
                    active: false,
                    connections: new Set(),
                    outputBuffer: session.outputBuffer || [],
                    maxBufferSize: 1000
                });
            }

            console.log(`Restored ${sessions.size} sessions from disk`);
            return sessions;
        } catch (error) {
            // File doesn't exist or is corrupted, return empty Map
            if (error.code !== 'ENOENT') {
                console.error('Failed to load sessions:', error);
            }
            return new Map();
        }
    }

    async clearOldSessions() {
        try {
            await fs.unlink(this.sessionsFile);
            console.log('Cleared old sessions');
            return true;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Failed to clear sessions:', error);
            }
            return false;
        }
    }

    async getSessionMetadata() {
        try {
            await fs.access(this.sessionsFile);
            const stats = await fs.stat(this.sessionsFile);
            const data = await fs.readFile(this.sessionsFile, 'utf8');
            const parsed = JSON.parse(data);
            
            return {
                exists: true,
                savedAt: parsed.savedAt,
                sessionCount: parsed.sessions ? parsed.sessions.length : 0,
                fileSize: stats.size,
                version: parsed.version
            };
        } catch (error) {
            return {
                exists: false,
                error: error.message
            };
        }
    }
}

module.exports = SessionStore;