// --- Imports and Initial Setup ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

// Import our custom modules
const { validateEnvironmentVariables, parseCommand, logIncomingMessage, sendMessage } = require('./utils');
const {
  handleRegistration,
  handleHelp,
  handleStatus,
  handleUnregister,
  handleUnknownCommand,
  handleExistingUser
} = require('./handlers');
const messages = require('./messages');

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
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  ADMIN_PASSWORD,
  USER_PASSWORD,
} = process.env;

const VERIFY_TOKEN = 'produktbot_verify';
const PORT = process.env.PORT || 3000;

// In-memory state for registration flow.
// NOTE: This will reset if the server restarts. For production,
// consider storing this state in your Supabase database.
let registrationState = {};

// --- Service Clients ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();
app.use(bodyParser.json());

// --- Express Routes ---

/**
 * Root route for health checks and basic availability verification.
 */
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    message: 'Produkt Bot server is running and healthy!',
    timestamp: new Date().toISOString()
  });
});

/**
 * Webhook verification route for Meta.
 * Handles the initial challenge request from the WhatsApp Cloud API setup.
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ [SUCCESS] Webhook verified.');
    res.status(200).send(challenge);
  } else {
    console.error('❌ [FAILURE] Webhook verification failed. Token mismatch or missing parameters.');
    res.sendStatus(403);
  }
});

/**
 * Main webhook route for receiving incoming WhatsApp messages.
 */
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) {
      // This can be a status update or other non-message event.
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.trim();
    if (!text) return res.sendStatus(200); // Ignore non-text messages

    // Check if the user exists in the database
    let { data: user, error: userError } = await supabase
      .from('bot_users')
      .select('*')
      .eq('bot_userphone', from)
      .maybeSingle();

    if (userError) {
      console.error('❌ Supabase error fetching user:', userError);
      await sendMessage(from, messages.system.databaseError);
      return res.sendStatus(200);
    }

    // Log the incoming message for debugging
    logIncomingMessage(from, text, user);

    // Parse the command
    const command = parseCommand(text);
    const isRegistering = registrationState[from];

    // --- Handle Registration Flow ---
    if (!user || command === 'register' || isRegistering) {
      registrationState = await handleRegistration(from, text, registrationState, supabase);
      return res.sendStatus(200);
    }

    // --- Handle Commands for Registered Users ---
    switch (command) {
      case 'help':
        await handleHelp(from, user);
        break;

      case 'status':
        await handleStatus(from, user);
        break;

      case 'unregister':
        await handleUnregister(from, supabase);
        break;

      case null:
        // Not a recognized command, but user exists
        if (text.length > 0) {
          await handleUnknownCommand(from, text);
        } else {
          await handleExistingUser(from, user);
        }
        break;

      default:
        await handleUnknownCommand(from, command);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error in POST /webhook:', error);
    
    // Try to send an error message to the user if we have their phone number
    try {
      const from = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) {
        await sendMessage(from, messages.system.generalError);
      }
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
    
    res.sendStatus(500);
  }
});

// --- Additional API Routes (for future expansion) ---

/**
 * Get bot statistics (for admin dashboard)
 */
app.get('/api/stats', async (req, res) => {
  try {
    const { data: stats, error } = await supabase
      .from('bot_users')
      .select('bot_userrole, bot_userstatus')
      .eq('bot_userstatus', 'OPTIN');

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
  console.log(`📱 Webhook URL: https://your-domain.com/webhook`);
  console.log(`📊 Stats URL: https://your-domain.com/api/stats`);
  console.log(`✅ Server started successfully at ${new Date().toISOString()}`);
});