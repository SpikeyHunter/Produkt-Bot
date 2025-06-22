// --- Imports and Initial Setup ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

// Import utilities - UPDATED with fuzzy matching
const { 
  validateEnvironmentVariables, 
  parseCommandWithSuggestions,  // NEW: Enhanced parser
  logIncomingMessageWithTyping,
  sendMessage 
} = require('./utils');

// Import command handlers
const handleRegister = require('./commands/register');
const handleHelp = require('./commands/help');
const handleStatus = require('./commands/status');
const handleUnregister = require('./commands/unregister');
const handleListUsers = require('./commands/listUsers');

// --- Environment Variable Validation ---
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'WHATSAPP_TOKEN',
  'PHONE_NUMBER_ID',
  'ADMIN_PASSWORD',
  'USER_PASSWORD',
];

validateEnvironmentVariables(requiredEnvVars);

// --- Constants and Global State ---
const {
  SUPABASE_URL,
  SUPABASE_KEY,
} = process.env;

const VERIFY_TOKEN = 'produktbot_verify';
const PORT = process.env.PORT || 3000;

// In-memory state for registration flow and confirmations.
let registrationState = {};
let confirmationState = {};

// --- Service Clients ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();
app.use(bodyParser.json());

// --- Express Routes ---

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    message: 'Produkt Bot server is running and healthy!',
    timestamp: new Date().toISOString()
  });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ [SUCCESS] Webhook verified.');
    res.status(200).send(challenge);
  } else {
    console.error('❌ [FAILURE] Webhook verification failed.');
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();
    const messageId = message.id;
    
    if (!text) return res.sendStatus(200);

    // Check if user exists in database
    let { data: user, error: userError } = await supabase
      .from('bot_users')
      .select('*')
      .eq('bot_userphone', from)
      .maybeSingle();

    if (userError) {
      console.error('❌ Supabase error fetching user:', userError);
      await sendMessage(from, "⚠️ Technical issue. Please try again later.");
      return res.sendStatus(200);
    }

    logIncomingMessageWithTyping(from, text, user, messageId);

    // NEW: Enhanced command parsing with suggestions
    const commandResult = parseCommandWithSuggestions(text, user);
    const command = commandResult.command;
    const suggestion = commandResult.suggestion;

    const isRegistering = registrationState[from];
    const isConfirming = confirmationState[from];

    // --- Handle Registration Flow ---
    if ((!user && !isRegistering) || command === 'register') {
      if (user && command === 'register') {
        // User already registered, prevent re-registration
        await sendMessage(from, `❌ *Already Registered*

You're already registered as *${user.bot_username}* (${user.bot_userrole}).

Type *help* to see available commands.`);
        return res.sendStatus(200);
      }
      
      registrationState = await handleRegister(from, text, registrationState, supabase);
      return res.sendStatus(200);
    }

    // Handle registration in progress
    if (isRegistering) {
      registrationState = await handleRegister(from, text, registrationState, supabase);
      return res.sendStatus(200);
    }

    // Handle confirmation states
    if (isConfirming) {
      if (isConfirming.action === 'unregister') {
        confirmationState = await handleUnregister(from, text, confirmationState, supabase, user);
        return res.sendStatus(200);
      }
    }

    // --- Handle Commands for Registered Users ---
    if (!user) {
      // Unregistered user - start registration
      registrationState = await handleRegister(from, text, registrationState, supabase);
      return res.sendStatus(200);
    }

    // If we have a valid command, execute it
    if (command) {
      // Parse admin commands with parameters
      const textParts = text.toLowerCase().trim().split(' ');
      const baseCommand = textParts[0];
      const parameter = textParts.slice(1).join(' ');

      switch (command) {
        case 'help':
          await handleHelp(from, user);
          break;

        case 'status':
          await handleStatus(from, user, parameter, supabase);
          break;

        case 'unregister':
          if (user.bot_userrole === 'ADMIN' && parameter) {
            // Admin unregistering another user
            confirmationState = await handleUnregister(from, text, confirmationState, supabase, user, parameter);
          } else {
            // User unregistering themselves
            confirmationState = await handleUnregister(from, text, confirmationState, supabase, user);
          }
          break;

        case 'list':
          if (textParts[1] === 'users' && user.bot_userrole === 'ADMIN') {
            await handleListUsers(from, supabase);
          } else {
            await sendMessage(from, `❓ *Unknown Command*

I don't recognize "${text}".
Type *help* to see available commands.`);
          }
          break;

        default:
          await sendMessage(from, `👋 Hello ${user.bot_username}!

I don't recognize "${text}".
Type *help* to see what I can do for you.`);
      }
    } else if (suggestion && suggestion.message) {
      // NEW: Send suggestion for typos
      await sendMessage(from, suggestion.message);
    } else {
      // No command match and no good suggestion
      await sendMessage(from, `👋 Hello ${user.bot_username}!

I don't recognize "${text}".
Type *help* to see what I can do for you.`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error in POST /webhook:', error);
    
    try {
      const from = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) {
        await sendMessage(from, "😅 Something went wrong. Please try again!");
      }
    } catch (sendError) {
      console.error('❌ Failed to send error message:', sendError);
    }
    
    res.sendStatus(500);
  }
});

// --- Stats API ---
app.get('/api/stats', async (req, res) => {
  try {
    const { data: stats, error } = await supabase
      .from('bot_users')
      .select('bot_userrole');

    if (error) throw error;

    const summary = {
      total: stats.length,
      admins: stats.filter(u => u.bot_userrole === 'ADMIN').length,
      users: stats.filter(u => u.bot_userrole === 'USER').length,
      timestamp: new Date().toISOString()
    };

    res.json(summary);
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`🚀 Produkt Bot server is running on port ${PORT}`);
  console.log(`✅ Server started successfully at ${new Date().toISOString()}`);
});

// --- Keep-Alive (Prevent Render Sleep) ---
setInterval(() => {
  console.log('🔄 Keep-alive ping -', new Date().toISOString());
}, 13 * 60 * 1000); // Every 13 minutes