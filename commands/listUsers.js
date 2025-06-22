// commands/listUsers.js - List users command handler

const { sendMessage, formatPhoneNumber } = require('../utils');

// List users messages
const MESSAGES = {
  noUsers: `📋 *User List*

No users are currently registered in the system.`,

  userList: (users) => {
    let message = `📋 *Registered Users (${users.length})*\n\n`;
    
    users.forEach((user, index) => {
      const phoneFormatted = formatPhoneNumber(user.bot_userphone);
      const roleIcon = user.bot_userrole === 'ADMIN' ? '👨‍💼' : '👤';
      
      message += `${roleIcon} *${user.bot_username}*\n`;
      message += `   📱 ${phoneFormatted}\n`;
      message += `   🏷️ ${user.bot_userrole}\n`;
      
      if (index < users.length - 1) {
        message += '\n';
      }
    });
    
    return message;
  },

  accessDenied: `❌ *Access Denied*

Only admins can view the user list.

Type *help* to see your available commands.`,

  error: `⚠️ *Error Loading Users*

Unable to load the user list right now. Please try again later.`
};

/**
 * Handles list users command (admin only)
 * @param {string} from - User's phone number
 * @param {object} supabase - Supabase client
 */
async function handleListUsers(from, supabase) {
  try {
    // Get all registered users
    const { data: users, error } = await supabase
      .from('bot_users')
      .select('bot_username, bot_userphone, bot_userrole')
      .order('bot_username');

    if (error) {
      console.error('Error fetching users:', error);
      await sendMessage(from, MESSAGES.error);
      return;
    }

    if (!users || users.length === 0) {
      await sendMessage(from, MESSAGES.noUsers);
      return;
    }

    // Sort users: Admins first, then users, both alphabetically
    const sortedUsers = users.sort((a, b) => {
      if (a.bot_userrole === b.bot_userrole) {
        return a.bot_username.localeCompare(b.bot_username);
      }
      return a.bot_userrole === 'ADMIN' ? -1 : 1;
    });

    const userListMessage = MESSAGES.userList(sortedUsers);
    await sendMessage(from, userListMessage);

  } catch (error) {
    console.error('List users error:', error);
    await sendMessage(from, MESSAGES.error);
  }
}

module.exports = handleListUsers;