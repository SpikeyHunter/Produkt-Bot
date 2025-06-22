// utils.js - Utility functions for the WhatsApp bot

const axios = require('axios');

/**
 * Sends a WhatsApp message using the Meta Graph API.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The message body to send.
 */
async function sendMessage(to, text) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
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
    console.log(`✅ Message sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending message:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Validates environment variables at startup
 * @param {Array} requiredVars - Array of required environment variable names
 * @throws {Error} If any required variables are missing
 */
function validateEnvironmentVariables(requiredVars) {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(`FATAL ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  }
  console.log('✅ All required environment variables are present');
}

/**
 * Checks if a command is valid
 * @param {string} text - The user's message text
 * @returns {string|null} The normalized command or null if not a command
 */
function parseCommand(text) {
  if (!text) return null;
  
  const normalizedText = text.toLowerCase().trim();
  const validCommands = ['help', 'register', 'unregister', 'status', 'list', 'cancel', 'yes', 'no'];
  
  const firstWord = normalizedText.split(' ')[0];
  return validCommands.includes(firstWord) ? firstWord : null;
}

/**
 * Logs incoming messages for debugging
 * @param {string} from - Phone number of sender
 * @param {string} text - Message text
 * @param {object} user - User data if available
 */
function logIncomingMessage(from, text, user = null) {
  const timestamp = new Date().toISOString();
  const userInfo = user ? `${user.bot_username} (${user.bot_userrole})` : 'Unknown User';
  console.log(`📨 [${timestamp}] Message from ${from} (${userInfo}): "${text}"`);
}

/**
 * Sanitizes user input to prevent potential issues
 * @param {string} input - Raw user input
 * @returns {string} Sanitized input
 */
function sanitizeInput(input) {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .trim()
    .replace(/[^\w\s\-@.]/g, '') // Remove special characters except basic ones
    .substring(0, 100); // Limit length
}

/**
 * Formats phone numbers for display
 * @param {string} phoneNumber - Raw phone number
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  
  const digits = phoneNumber.toString().replace(/\D/g, '');
  
  // Format as +1 (555) 123-4567 for North American numbers
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  // For other numbers, just add + and group digits
  if (digits.length > 10) {
    return `+${digits}`;
  }
  
  return digits;
}

module.exports = {
  sendMessage,
  validateEnvironmentVariables,
  parseCommand,
  logIncomingMessage,
  sanitizeInput,
  formatPhoneNumber
};