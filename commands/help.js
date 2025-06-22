// commands/help.js - Help command handler

const { sendMessage } = require('../utils');

// Help messages for different user roles
const MESSAGES = {
  user: `👤 *User Commands*

🔹 *help* - Show this help menu
🔹 *status* - Check your current status
🔹 *unregister* - Remove your registration

Need more assistance? Just ask!`,

  admin: `👨‍💼 *Admin Commands*

🔹 *help* - Show this help menu
🔹 *status* - Check your current status
🔹 *status <username>* - Check another user's status
🔹 *unregister* - Remove your registration
🔹 *unregister <username>* - Remove another user
🔹 *list users* - View all registered users

Need more assistance? Just ask!`,

  general: `📋 *Available Commands*

🔹 *help* - Show this help menu
🔹 *register* - Start registration process

Need more assistance? Just ask!`
};

/**
 * Handles help command based on user role
 * @param {string} from - User's phone number
 * @param {object} user - User data from database
 */
async function handleHelp(from, user = null) {
  if (!user) {
    await sendMessage(from, MESSAGES.general);
    return;
  }

  switch (user.bot_userrole) {
    case 'ADMIN':
      await sendMessage(from, MESSAGES.admin);
      break;
    case 'USER':
      await sendMessage(from, MESSAGES.user);
      break;
    default:
      await sendMessage(from, MESSAGES.general);
  }
}

module.exports = handleHelp;