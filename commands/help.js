const { sendMessage } = require('../utils');

const MESSAGES = {
  user: `👤 *User Commands*

🔹 *sales* - View event sales figures
🔹 *help* - Show this help menu
🔹 *status* - Check your current status
🔹 *unregister* - Remove your registration

Need more assistance? Just ask!`,

  admin: `👨‍💼 *Admin Commands*
   *sales* - View event sales figures
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