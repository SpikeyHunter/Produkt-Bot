// commands/status.js - Status command handler

const { sendMessage, formatPhoneNumber } = require('../utils');

// Status messages
const MESSAGES = {
  userStatus: (username, role, phone) => `📊 *Your Status*

👤 *Name:* ${username}
🏷️ *Role:* ${role}
📱 *Phone:* ${formatPhoneNumber(phone)}
✅ *Status:* Active

You're all set up and ready to go!`,

  otherUserStatus: (username, role, phone) => `📊 *User Status*

👤 *Name:* ${username}
🏷️ *Role:* ${role}
📱 *Phone:* ${formatPhoneNumber(phone)}
✅ *Status:* Active`,

  userNotFound: (searchName) => `❌ *User Not Found*

No user found with the name "${searchName}".

Use *list users* to see all registered users.`,

  unregistered: `📊 *Your Status*

❌ You are not currently registered.

Type *register* to get started!`,

  accessDenied: `❌ *Access Denied*

Only admins can check other users' status.

Type *help* to see your available commands.`,

  invalidCommand: `❓ *Invalid Command*

Usage: *status* or *status <username>*

Type *help* for more information.`
};

/**
 * Handles status command
 * @param {string} from - User's phone number
 * @param {object} user - User data from database
 * @param {string} parameter - Optional username parameter
 * @param {object} supabase - Supabase client
 */
async function handleStatus(from, user, parameter = '', supabase) {
  if (!user) {
    await sendMessage(from, MESSAGES.unregistered);
    return;
  }

  // If no parameter, show user's own status
  if (!parameter) {
    const statusMessage = MESSAGES.userStatus(
      user.bot_username,
      user.bot_userrole,
      user.bot_userphone
    );
    await sendMessage(from, statusMessage);
    return;
  }

  // Parameter provided - admin checking another user
  if (user.bot_userrole !== 'ADMIN') {
    await sendMessage(from, MESSAGES.accessDenied);
    return;
  }

  try {
    // Search for user by username
    const { data: targetUser, error } = await supabase
      .from('bot_users')
      .select('*')
      .ilike('bot_username', parameter)
      .maybeSingle();

    if (error) {
      console.error('Error searching for user:', error);
      await sendMessage(from, "⚠️ Technical issue. Please try again later.");
      return;
    }

    if (!targetUser) {
      await sendMessage(from, MESSAGES.userNotFound(parameter));
      return;
    }

    const statusMessage = MESSAGES.otherUserStatus(
      targetUser.bot_username,
      targetUser.bot_userrole,
      targetUser.bot_userphone
    );
    await sendMessage(from, statusMessage);

  } catch (error) {
    console.error('Status command error:', error);
    await sendMessage(from, "😅 Something went wrong. Please try again!");
  }
}

module.exports = handleStatus;