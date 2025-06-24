// middleware/rateLimiter.js - WhatsApp compliant rate limiting
class RateLimiter {
  constructor() {
    this.userRequests = new Map();
    this.globalRequests = [];
    
    // WhatsApp Business API limits
    this.limits = {
      perUser: {
        requests: 10,    // messages per user
        window: 60000    // 1 minute
      },
      global: {
        requests: 250,   // total messages
        window: 60000    // 1 minute
      }
    };

    // Clean up old requests every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if request is allowed for user
   */
  isAllowed(userId) {
    const now = Date.now();
    
    // Check global rate limit
    if (!this.checkGlobalLimit(now)) {
      return {
        allowed: false,
        reason: 'global_limit',
        message: '⚠️ *Service Temporarily Busy*\n\nPlease try again in a moment.'
      };
    }

    // Check per-user rate limit
    if (!this.checkUserLimit(userId, now)) {
      return {
        allowed: false,
        reason: 'user_limit',
        message: '⚠️ *Slow Down*\n\nYou\'re sending messages too quickly. Please wait a moment before trying again.'
      };
    }

    // Record this request
    this.recordRequest(userId, now);
    
    return { allowed: true };
  }

  /**
   * Check global rate limit
   */
  checkGlobalLimit(now) {
    this.globalRequests = this.globalRequests.filter(
      time => now - time < this.limits.global.window
    );
    
    return this.globalRequests.length < this.limits.global.requests;
  }

  /**
   * Check per-user rate limit
   */
  checkUserLimit(userId, now) {
    if (!this.userRequests.has(userId)) {
      return true;
    }

    const userReqs = this.userRequests.get(userId);
    const recentRequests = userReqs.filter(
      time => now - time < this.limits.perUser.window
    );

    this.userRequests.set(userId, recentRequests);
    
    return recentRequests.length < this.limits.perUser.requests;
  }

  /**
   * Record a new request
   */
  recordRequest(userId, timestamp) {
    // Record global request
    this.globalRequests.push(timestamp);

    // Record user request
    if (!this.userRequests.has(userId)) {
      this.userRequests.set(userId, []);
    }
    this.userRequests.get(userId).push(timestamp);
  }

  /**
   * Clean up old requests
   */
  cleanup() {
    const now = Date.now();
    
    // Clean global requests
    this.globalRequests = this.globalRequests.filter(
      time => now - time < this.limits.global.window
    );

    // Clean user requests
    for (const [userId, requests] of this.userRequests.entries()) {
      const recentRequests = requests.filter(
        time => now - time < this.limits.perUser.window
      );
      
      if (recentRequests.length === 0) {
        this.userRequests.delete(userId);
      } else {
        this.userRequests.set(userId, recentRequests);
      }
    }

    console.log(`🧹 Rate limiter cleanup: ${this.userRequests.size} active users, ${this.globalRequests.length} global requests`);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      activeUsers: this.userRequests.size,
      globalRequests: this.globalRequests.length,
      limits: this.limits
    };
  }
}

module.exports = new RateLimiter();