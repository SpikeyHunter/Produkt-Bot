// Enhanced index.js with improvements
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

// Import utilities
const { 
  validateEnvironmentVariables, 
  parseCommandWithSuggestions,
  logIncomingMessageWithTyping,
  sendMessage 
} = require('./utils');

// Import command handlers
const handleRegister = require('./commands/register');
const handleHelp = require('./commands/help');
const handleStatus = require('./commands/status');
const handleUnregister = require('./commands/unregister');
const handleListUsers = require('./commands/listUsers');
const handleSales = require('./commands/sales');

// Import new modules
const rateLimiter = require('./middleware/rateLimiter');
const templates = require('./templates/templateLoader');
const database = require('./scripts/database');
const { manageEventSync } = require('./eventManager');

// Environment validation
const requiredEnvVars = [
  'SUPABASE_URL', 'SUPABASE_KEY', 'WHATSAPP_TOKEN', 
  'PHONE_NUMBER_ID', 'ADMIN_PASSWORD', 'USER_PASSWORD'
];
validateEnvironmentVariables(requiredEnvVars);

// Constants
const VERIFY_TOKEN = 'produktbot_verify';
const PORT = process.env.PORT || 3000;

// State management (consider Redis for production)
let registrationState = {};
let confirmationState = {};
let salesState = {};

// Service clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const app = express();

// Enhanced middleware
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Produkt-Bot');
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    message: 'Produkt Bot server is running!',
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    features: ['rate_limiting', 'templates', 'enhanced_logging']
  });
});

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Enhanced webhook handler
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    
    // Validate message structure
    if (!message || message.type !== 'text') {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.trim();
    const messageId = message.id;
    
    if (!text || from === process.env.PHONE_NUMBER_ID) {
      return res.sendStatus(200);
    }

    // Rate limiting check
    const rateCheck = rateLimiter.isAllowed(from);
    if (!rateCheck.allowed) {
      await sendMessage(from, rateCheck.message);
      return res.sendStatus(200);
    }

    // Background event sync
    manageEventSync().catch(err => 
      console.error("Event Sync Background Process Failed:", err)
    );

    // Get user data
    const userResult = await database.getUser(from);
    const user = userResult.success ? userResult.user : null;

    if (userResult.success === false) {
      console.error('Database error:', userResult.error);
      const errorMessage = templates.get('errors', { 
        errorCode: Date.now().toString().slice(-6) 
      });
      await sendMessage(from, errorMessage);
      return res.sendStatus(200);
    }

    // Log incoming message
    logIncomingMessageWithTyping(from, text, user, messageId);

    // Parse command with suggestions
    const commandResult = parseCommandWithSuggestions(text, user);
    const command = commandResult.command;
    const suggestion = commandResult.suggestion;

    // Check for ongoing flows
    const isRegistering = registrationState[from];
    const isConfirming = confirmationState[from];
    const isHandlingSales = salesState[from];

    // Handle ongoing flows
    if (isRegistering) {
      registrationState = await handleRegister(from, text, registrationState, supabase);
      return res.sendStatus(200);
    }

    if (isConfirming?.action === 'unregister') {
      confirmationState = await handleUnregister(from, text, confirmationState, supabase, user);
      return res.sendStatus(200);
    }

    if (isHandlingSales) {
      salesState = await handleSales(from, text, salesState, supabase, user);
      return res.sendStatus(200);
    }
    
    // Handle new commands
    if (!user && command !== 'register') {
      await handleHelp(from, null);
      return res.sendStatus(200);
    }

    if (command) {
      const textParts = text.toLowerCase().trim().split(' ');
      const parameter = textParts.slice(1).join(' ');

      switch (command) {
        case 'help':
          await handleHelp(from, user);
          break;

        case 'register':
          registrationState = await handleRegister(from, text, registrationState, supabase);
          break;

        case 'status':
          await handleStatus(from, user, parameter, supabase);
          break;

        case 'unregister':
          const targetUsername = user?.bot_userrole === 'ADMIN' && parameter ? parameter : '';
          confirmationState = await handleUnregister(from, text, confirmationState, supabase, user, targetUsername);
          break;

        case 'list':
          if (textParts[1] === 'users' && user?.bot_userrole === 'ADMIN') {
            await handleListUsers(from, supabase);
          } else {
            const unknownMessage = `❓ *Unknown Command*\n\nI don't recognize "${text}".\nType *help* to see available commands.`;
            await sendMessage(from, unknownMessage);
          }
          break;
        
        case 'sales':
          salesState = await handleSales(from, text, salesState, supabase, user);
          break;

        default:
          const defaultMessage = user 
            ? `👋 Hello ${user.bot_username}!\n\nI don't recognize "${text}".\nType *help* to see what I can do for you.`
            : `👋 Hello!\n\nI don't recognize "${text}".\nType *register* to get started or *help* for more information.`;
          await sendMessage(from, defaultMessage);
      }
    } else if (suggestion?.message) {
      await sendMessage(from, suggestion.message);
    } else {
      const fallbackMessage = user 
        ? `👋 Hello ${user.bot_username}!\n\nI don't recognize "${text}".\nType *help* to see what I can do for you.`
        : `👋 Hello!\n\nType *register* to get started or *help* for more information.`;
      await sendMessage(from, fallbackMessage);
    }

    res.sendStatus(200);

  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    try {
      const from = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) {
        const errorMessage = templates.get('errors', { 
          errorCode: Date.now().toString().slice(-6) 
        });
        await sendMessage(from, errorMessage);
      }
    } catch (sendError) {
      console.error('❌ Failed to send error message:', sendError);
    }
    
    res.sendStatus(500);
  }
});

// Enhanced stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const [dbStats, rateLimitStats] = await Promise.all([
      database.getAllUsers(),
      Promise.resolve(rateLimiter.getStatus())
    ]);

    if (!dbStats.success) {
      throw new Error(dbStats.error);
    }

    const users = dbStats.users || [];
    const summary = {
      users: {
        total: users.length,
        admins: users.filter(u => u.bot_userrole === 'ADMIN').length,
        regular: users.filter(u => u.bot_userrole === 'USER').length
      },
      rateLimiting: rateLimitStats,
      templates: {
        loaded: templates.list().length,
        available: templates.list()
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    };

    res.json(summary);
  } catch (error) {
    console.error('❌ Stats endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch statistics',
      timestamp: new Date().toISOString() 
    });
  }
});

// Admin endpoint for template reload (useful for development)
app.post('/api/admin/reload-templates', (req, res) => {
  try {
    templates.reload();
    res.json({ 
      success: true, 
      message: 'Templates reloaded successfully',
      count: templates.list().length 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test database connection on startup
database.testConnection()
  .then(result => {
    if (result.success) {
      console.log('✅ Database connection verified');
    } else {
      console.error('❌ Database connection failed:', result.error);
    }
  });

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Produkt Bot server running on port ${PORT}`);
  console.log(`✅ Server started at ${new Date().toISOString()}`);
  console.log(`📊 Features: Rate Limiting, Templates, Enhanced Logging`);
  console.log(`📋 Templates loaded: ${templates.list().length}`);
});

// Keep-alive for Render.com
setInterval(() => {
  console.log(`🔄 Keep-alive ping - ${new Date().toISOString()}`);
}, 13 * 60 * 1000);