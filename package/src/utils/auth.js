const crypto = require('crypto');

class AuthManager {
    constructor() {
        this.tokens = new Set();
        this.rateLimiter = new Map();
    }

    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    validateToken(token) {
        return this.tokens.has(token);
    }

    addToken(token) {
        this.tokens.add(token);
    }

    removeToken(token) {
        this.tokens.delete(token);
    }

    clearTokens() {
        this.tokens.clear();
    }

    createMiddleware(requiredToken) {
        return (req, res, next) => {
            if (!requiredToken) {
                return next();
            }

            const authHeader = req.headers.authorization;
            const queryToken = req.query.token;
            
            let providedToken = null;
            
            if (authHeader && authHeader.startsWith('Bearer ')) {
                providedToken = authHeader.substring(7);
            } else if (queryToken) {
                providedToken = queryToken;
            }

            if (!providedToken || providedToken !== requiredToken) {
                return res.status(401).json({ 
                    error: 'Unauthorized',
                    message: 'Valid authentication token required'
                });
            }

            next();
        };
    }

    createWebSocketValidator(requiredToken) {
        return (info) => {
            if (!requiredToken) {
                return true;
            }

            const url = new URL(info.req.url, 'ws://localhost');
            const token = url.searchParams.get('token');
            
            return token === requiredToken;
        };
    }

    rateLimit(identifier, maxRequests = 100, windowMs = 60000) {
        const now = Date.now();
        const windowStart = now - windowMs;
        
        if (!this.rateLimiter.has(identifier)) {
            this.rateLimiter.set(identifier, []);
        }
        
        const requests = this.rateLimiter.get(identifier);
        const validRequests = requests.filter(timestamp => timestamp > windowStart);
        
        if (validRequests.length >= maxRequests) {
            return false;
        }
        
        validRequests.push(now);
        this.rateLimiter.set(identifier, validRequests);
        
        return true;
    }

    createRateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
        return (req, res, next) => {
            const identifier = req.ip || req.connection.remoteAddress;
            
            if (!this.rateLimit(identifier, maxRequests, windowMs)) {
                return res.status(429).json({
                    error: 'Too Many Requests',
                    message: 'Rate limit exceeded. Please try again later.',
                    retryAfter: Math.ceil(windowMs / 1000)
                });
            }
            
            next();
        };
    }

    cleanupRateLimit() {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        
        for (const [identifier, requests] of this.rateLimiter.entries()) {
            const validRequests = requests.filter(timestamp => (now - timestamp) < oneHour);
            
            if (validRequests.length === 0) {
                this.rateLimiter.delete(identifier);
            } else {
                this.rateLimiter.set(identifier, validRequests);
            }
        }
    }
}

module.exports = AuthManager;