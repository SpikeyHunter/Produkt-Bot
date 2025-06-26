// utils.js - COMPLETE with all functions and optimizations

const axios = require('axios');

/**
 * Calculates Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function getEditDistance(a, b) {
  const matrix = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Finds the closest matching command for a typo
 * @param {string} input - User's input
 * @param {object} user - User data (for role-based commands)
 * @returns {object} { suggestion: string, confidence: number, message: string }
 */
function findClosestCommand(input, user = null) {
  const baseCommands = ['help', 'register', 'unregister', 'status', 'sales', 'timezone', 'promoter'];
  const adminCommands = user?.bot_userrole === 'ADMIN' ? ['list users'] : [];
  const allCommands = [...baseCommands, ...adminCommands];
  
  const inputLower = input.toLowerCase().trim();
  let bestMatch = null;
  let bestDistance = Infinity;
  
  for (const command of allCommands) {
    const distance = getEditDistance(inputLower, command);
    const maxLength = Math.max(inputLower.length, command.length);
    const similarity = 1 - (distance / maxLength);
    
    // Only suggest if similarity is reasonable (60%+ match)
    if (similarity >= 0.6 && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = {
        command: command,
        similarity: similarity,
        distance: distance
      };
    }
  }
  
  if (bestMatch) {
    // Different suggestion messages based on confidence
    if (bestMatch.similarity >= 0.8) {
      // High confidence - likely typo
      return {
        suggestion: bestMatch.command,
        confidence: 'high',
        message: `❓ *Did you mean "${bestMatch.command}"?*

Type *${bestMatch.command}* to continue, or *help* to see all commands.`
      };
    } else if (bestMatch.similarity >= 0.6) {
      // Medium confidence - possible match
      return {
        suggestion: bestMatch.command,
        confidence: 'medium',
        message: `❓ *Command not recognized*

Did you mean *${bestMatch.command}*? 

Type *help* to see all available commands.`
      };
    }
  }
  
  // No good match found
  return {
    suggestion: null,
    confidence: 'none',
    message: null
  };
}

/**
 * Enhanced command parser with typo detection
 * @param {string} text - The user's message text
 * @param {object} user - User data for role-based commands
 * @returns {object} { command: string|null, suggestion: object|null }
 */
function parseCommandWithSuggestions(text, user = null) {
  if (!text) return { command: null, suggestion: null };
  
  const normalizedText = text.toLowerCase().trim();
  // Updated with timezone and promoter commands
  const validCommands = ['help', 'register', 'unregister', 'status', 'sales', 'timezone', 'promoter', 'list', 'cancel', 'yes', 'no', 'all', '1', '2', '3'];
  
  // Check for multi-word commands first
  if (normalizedText.startsWith('list ')) {
    const secondWord = normalizedText.split(' ')[1];
    if (secondWord === 'users') {
      return { command: 'list', suggestion: null };
    }
  }
  
  const firstWord = normalizedText.split(' ')[0];
  
  // Exact match
  if (validCommands.includes(firstWord)) {
    return { command: firstWord, suggestion: null };
  }
  
  // No exact match - look for suggestions
  const suggestion = findClosestCommand(firstWord, user);
  return { command: null, suggestion: suggestion };
}

/**
 * Marks a message as read and shows typing indicator
 * @param {string} messageId - The message ID to mark as read
 */
async function markAsReadWithTyping(messageId) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: {
          type: 'text'
        }
      },
      {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
      }
    );
    console.log(`✅ Message ${messageId} marked as read with typing indicator`);
  } catch (error) {
    console.log(`⚠️ Mark as read with typing failed (non-critical): ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Sends a typing indicator using the official WhatsApp API method
 * @param {string} messageId - The message ID that triggered the response
 */
async function sendTypingIndicator(messageId) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: {
          type: 'text'
        }
      },
      {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
      }
    );
    console.log(`💬 Typing indicator sent for message ${messageId}`);
  } catch (error) {
    console.log(`⚠️ Typing indicator failed (non-critical): ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * OPTIMIZED: Sends a WhatsApp message with reduced delay for better performance
 * @param {string} to - The recipient's phone number
 * @param {string} text - The message body to send
 * @param {number} typingDuration - How long to show typing (milliseconds)
 */
async function sendMessage(to, text, typingDuration = null) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    // OPTIMIZED: Reduced delays for better performance
    if (typingDuration === null) {
      const baseTime = 200; // Reduced from 500ms to 200ms
      const words = text.split(' ').length;
      const calculatedTime = Math.min(600, baseTime + (words * 20)); // 20ms per word, max 600ms (down from 1200ms)
      typingDuration = calculatedTime;
    }

    // Simulate typing delay
    if (typingDuration > 0) {
      await new Promise(resolve => setTimeout(resolve, typingDuration));
    }
    
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
    
    console.log(`✅ Message sent to ${to} (after ${typingDuration}ms delay)`);
    
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
 * Sends a WhatsApp message with interactive buttons
 * @param {string} to - The recipient's phone number
 * @param {string} bodyText - The main message text
 * @param {Array} buttons - Array of button objects [{id: "btn1", title: "Button 1"}, ...]
 * @param {string} headerText - Optional header text
 * @param {string} footerText - Optional footer text
 */
async function sendMessageWithButtons(to, bodyText, buttons, headerText = null, footerText = null) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    // Format buttons for WhatsApp API (max 3 buttons)
    const formattedButtons = buttons.slice(0, 3).map((btn, index) => ({
      type: "reply",
      reply: {
        id: btn.id || `btn_${index}`,
        title: btn.title.substring(0, 20) // Max 20 characters
      }
    }));

    const messageBody = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: bodyText
        },
        action: {
          buttons: formattedButtons
        }
      }
    };

    // Add optional header
    if (headerText) {
      messageBody.interactive.header = {
        type: 'text',
        text: headerText
      };
    }

    // Add optional footer
    if (footerText) {
      messageBody.interactive.footer = {
        text: footerText
      };
    }

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      messageBody,
      {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
      }
    );
    
    console.log(`🔘 Interactive buttons sent to ${to}`);
    
  } catch (error) {
    console.error('❌ Error sending interactive buttons:', error.response ? error.response.data : error.message);
    
    // Fallback: Send as regular text message
    console.log('📝 Falling back to text message...');
    const fallbackText = `${bodyText}\n\n` + buttons.map((btn, i) => `${i + 1}. ${btn.title}`).join('\n');
    await sendMessageInstant(to, fallbackText);
  }
}

/**
 * Sends a WhatsApp list message (for more than 3 options)
 * @param {string} to - The recipient's phone number
 * @param {string} bodyText - The main message text
 * @param {string} buttonText - Text on the list button (e.g., "Select Option")
 * @param {Array} sections - Array of section objects with rows
 */
async function sendMessageWithList(to, bodyText, buttonText, sections) {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;
  
  try {
    const messageBody = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text: bodyText
        },
        action: {
          button: buttonText,
          sections: sections
        }
      }
    };

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      messageBody,
      {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
      }
    );
    
    console.log(`📋 Interactive list sent to ${to}`);
    
  } catch (error) {
    console.error('❌ Error sending interactive list:', error.response ? error.response.data : error.message);
    
    // Fallback: Send as regular text message
    console.log('📝 Falling back to text message...');
    let fallbackText = `${bodyText}\n\n`;
    sections.forEach(section => {
      if (section.title) fallbackText += `*${section.title}*\n`;
      section.rows.forEach((row, i) => {
        fallbackText += `${i + 1}. ${row.title}\n`;
      });
      fallbackText += '\n';
    });
    await sendMessageInstant(to, fallbackText);
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
 * Legacy function for backwards compatibility
 * @param {string} text - The user's message text
 * @returns {string|null} The normalized command or null if not a command
 */
function parseCommand(text) {
  const result = parseCommandWithSuggestions(text);
  return result.command;
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
 * Enhanced logging for incoming messages with auto-read and typing
 * @param {string} from - Phone number of sender
 * @param {string} text - Message text
 * @param {object} user - User data if available
 * @param {string} messageId - Message ID for read receipts and typing
 */
function logIncomingMessageWithTyping(from, text, user = null, messageId = null) {
  const timestamp = new Date().toISOString();
  const userInfo = user ? `${user.bot_username} (${user.bot_userrole})` : 'Unknown User';
  console.log(`📨 [${timestamp}] Message from ${from} (${userInfo}): "${text}"`);
  
  // Automatically mark message as read and show typing indicator
  if (messageId) {
    markAsReadWithTyping(messageId);
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
  sendMessage,                     // Main function with auto-delay
  sendMessageInstant,             // No delay
  sendMessageWithTyping,          // Custom delay duration
  sendMessageWithButtons,         // WhatsApp interactive buttons
  sendMessageWithList,           // WhatsApp list picker
  sendTypingIndicator,            // Official typing indicator
  markAsReadWithTyping,           // Mark as read + typing ⭐ THIS WAS MISSING
  logIncomingMessageWithTyping,   // Enhanced logging with typing ⭐ THIS WAS MISSING
  validateEnvironmentVariables,
  parseCommand,                   // Legacy function
  parseCommandWithSuggestions,    // Enhanced parser with suggestions
  findClosestCommand,             // Command suggestion finder
  logIncomingMessage,
  sanitizeInput,
  formatPhoneNumber
};