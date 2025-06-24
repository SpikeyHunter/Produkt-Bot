// config/constants.js - Application constants
module.exports = {
  // Bot information
  BOT_VERSION: '2.1.0',
  BOT_NAME: 'Produkt Bot',
  
  // Rate limiting
  RATE_LIMITS: {
    PER_USER: {
      REQUESTS: 10,
      WINDOW: 60000 // 1 minute
    },
    GLOBAL: {
      REQUESTS: 250,
      WINDOW: 60000 // 1 minute  
    }
  },
  
  // User roles
  USER_ROLES: {
    ADMIN: 'ADMIN',
    USER: 'USER'
  },
  
  // User status
  USER_STATUS: {
    OPTIN: 'OPTIN',
    OPTOUT: 'OPTOUT'
  },
  
  // Command types
  COMMANDS: {
    HELP: 'help',
    REGISTER: 'register', 
    UNREGISTER: 'unregister',
    STATUS: 'status',
    SALES: 'sales',
    LIST: 'list',
    CANCEL: 'cancel',
    YES: 'yes',
    NO: 'no'
  },
  
  // Message types
  MESSAGE_TYPES: {
    TEXT: 'text',
    IMAGE: 'image',
    DOCUMENT: 'document'
  },
  
  // Business hours (optional)
  BUSINESS_HOURS: {
    START: 9, // 9 AM
    END: 21,  // 9 PM
    TIMEZONE: 'America/New_York'
  },
  
  // API timeouts
  TIMEOUTS: {
    WHATSAPP_API: 10000,   // 10 seconds
    TIXR_API: 15000,       // 15 seconds
    DATABASE: 5000         // 5 seconds
  },
  
  // Cleanup intervals
  CLEANUP_INTERVALS: {
    RATE_LIMITER: 60000,    // 1 minute
    KEEP_ALIVE: 780000      // 13 minutes
  }
};