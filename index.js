// --- Imports and Initial Setup ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// --- Environment Variable Validation ---
// Ensure all required environment variables are set before starting the app.
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'WHATSAPP_TOKEN',
  'PHONE_NUMBER_ID',
  'ADMIN_PASSWORD',
  'USER_PASSWORD',
];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  throw new Error(`FATAL ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
}

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
// NOTE: This will reset if the server restarts. For a more robust solution,
// consider storing this state in your Supabase database.
let registrationState = {};

// --- Service Clients ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();
app.use(bodyParser.json());

// --- Helper Functions ---

/**
 * Sends a WhatsApp message using the Meta Graph API.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The message body to send.
 */
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        text: { body: text },
      },
      {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
      }
    );
    console.log(`Message sent to ${to}: "${text}"`);
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

// --- Express Routes ---

/**
 * Root route for health checks and basic availability verification.
 */
app.get('/', (req, res) => {
  res.status(200).send('Produkt Bot server is running and healthy!');
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
    console.log('[SUCCESS] Webhook verified.');
    res.status(200).send(challenge);
  } else {
    console.error('[FAILURE] Webhook verification failed. Token mismatch or missing parameters.');
    res.sendStatus(403); // Forbidden
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
      // Acknowledging with 200 is important.
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.trim();
    if (!text) return res.sendStatus(200); // Ignore non-text messages

    // Check if the user is in the database
    let { data: user, error: userError } = await supabase
      .from('bot_users')
      .select('*')
      .eq('bot_userphone', from)
      .maybeSingle();

    if (userError) {
        console.error('Supabase error fetching user:', userError);
        await sendMessage(from, "Sorry, I'm having trouble with my database. Please try again later.");
        return res.sendStatus(200);
    }
    
    // --- Registration Logic ---
    const isRegistering = registrationState[from];
    if (!user || text.toLowerCase() === 'register' || isRegistering) {
      
      if (!isRegistering) {
        registrationState[from] = { step: 1 };
        await sendMessage(from, "Welcome to Produkt BOT! To register, what name should I call you?");
      } else if (isRegistering.step === 1) {
        registrationState[from].username = text;
        registrationState[from].step = 2;
        await sendMessage(from, "Great. Now, please enter the registration password:");
      } else if (isRegistering.step === 2) {
        const password = text;
        let role = '';

        if (password === ADMIN_PASSWORD) role = 'ADMIN';
        else if (password === USER_PASSWORD) role = 'USER';
        else {
          await sendMessage(from, "That password was incorrect. Please try again, or type 'cancel' to stop.");
          return res.sendStatus(200);
        }

        const { error: insertError } = await supabase.from('bot_users').upsert({
          bot_userphone: from,
          bot_username: registrationState[from].username,
          bot_userstatus: 'OPTIN',
          bot_userrole: role,
        }, { onConflict: 'bot_userphone' });
        
        if (insertError) {
          console.error('Supabase error inserting/updating user:', insertError);
          await sendMessage(from, "Sorry, I couldn't save your registration. Please try again later.");
        } else {
          await sendMessage(from, `Thank you, ${registrationState[from].username}! You are now registered as a ${role}.`);
        }
        delete registrationState[from]; // Clean up state
      }
      return res.sendStatus(200);
    }
    
    // --- Command Logic for Registered Users ---
    if (text.toLowerCase() === 'unregister') {
      await supabase.from('bot_users').update({ bot_userstatus: 'OPTOUT' }).eq('bot_userphone', from);
      await sendMessage(from, "You have been successfully unregistered. Send 'register' anytime to rejoin.");
    } else {
      // Default response for registered users
      await sendMessage(from, `Hi ${user.bot_username}, you are already registered as a ${user.bot_userrole}.`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error in POST /webhook:', error);
    res.sendStatus(500); // Internal Server Error
  }
});

// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Produkt Bot server is running on port ${PORT}`);
});