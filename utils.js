// utils.js - Utility functions for the WhatsApp bot

const axios = require('axios');

/**
 * Sends a typing indicator to WhatsApp
 * @param {string} to - The recipient's phone number
 * @param {string} action - 'typing_on' or 'typing_off'
 */
async function sendTypingIndicator(to, action = 'typing_on') {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: action
      },
      {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
      }
    );
    console.log(`💬 Typing indicator (${action}) sent to ${to}`);
  } catch (error) {
    // Don't throw error for typing indicators - just log and continue
    console.log(`⚠️ Typing indicator failed (non-critical): ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Marks a message as read
 * @param {string} messageId - The message ID to mark as read
 */
async function markAsRead(messageId) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      },
      {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
      }
    );
    console.log(`✅ Message ${messageId} marked as read`);
  } catch (error) {
    console.log(`⚠️ Mark as read failed (non-critical): ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Sends a WhatsApp message with typing indicator for natural feel
 * @param {string} to - The recipient's phone number
 * @param {string} text - The message body to send
 * @param {number} typingDuration - How long to show typing (milliseconds)
 */
async function sendMessage(to, text, typingDuration = null) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    // Auto-calculate typing duration based on message length for natural feel
    if (typingDuration === null) {
      const baseTime = 800; // Minimum typing time
      const wordsPerMinute = 200; // Simulated typing speed
      const words = text.split(' ').length;
      const calculatedTime = Math.min(3000, baseTime + (words / wordsPerMinute) * 60000);
      typingDuration = calculatedTime;
    }

    // Show typing indicator
    await sendTypingIndicator(to, 'typing_on');
    
    // Wait to simulate natural typing/thinking
    await new Promise(resolve => setTimeout(resolve, typingDuration));
    
    // Send the actual message
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
    
    console.log(`✅ Message sent to ${to} (after ${typingDuration}ms typing)`);
    
    // Turn off typing indicator (optional - usually auto-stops after message)
    await sendTypingIndicator(to, 'typing_off');
    
  } catch (error) {
    console.error('❌ Error sending message:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Sends a message immediately without typing indicator (for urgent/system messages)
 * @param {string} to - The recipient's phone number
 * @param {string} text - The message body to send
 */
async function sendMessageInstant(to, text) {
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
    console.log(`⚡ Instant message sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending instant message:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Sends a message with custom typing duration
 * @param {string} to - The recipient's phone number
 * @param {string} text - The message body to send
 * @param {number} customTypingMs - Custom typing duration in milliseconds
 */
async function sendMessageWithTyping(to, text, customTypingMs) {
  return await sendMessage(to, text, customTypingMs);
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
 * Enhanced logging for incoming messages with auto-read functionality
 * @param {string} from - Phone number of sender
 * @param {string} text - Message text
 * @param {object} user - User data if available
 * @param {string} messageId - Message ID for read receipts
 */
function logIncomingMessageWithRead(from, text, user = null, messageId = null) {
  logIncomingMessage(from, text, user);
  
  // Automatically mark message as read for better UX
  if (messageId) {
    markAsRead(messageId);
  }
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
  sendMessage,                    // Main function with auto-typing
  sendMessageInstant,            // No typing indicator
  sendMessageWithTyping,         // Custom typing duration
  sendTypingIndicator,           // Manual typing control
  markAsRead,                    // Mark messages as read
  validateEnvironmentVariables,
  parseCommand,
  logIncomingMessage,
  logIncomingMessageWithRead,    // Auto-read version
  sanitizeInput,
  formatPhoneNumber
};