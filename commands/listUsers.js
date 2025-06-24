// commands/listUsers.js - List users command handler with templates
const { sendMessage, formatPhoneNumber } = require('../utils');
const templates = require('../templates/templateLoader');

async function handleListUsers(from, supabase) {
  try {
    // Get all registered users
    const { data: users, error } = await supabase
      .from('bot_users')
      .select('bot_username, bot_userphone, bot_userrole')
      .order('bot_username');

    if (error) {
      console.error('Error fetching users:', error);
      await sendMessage(from, `⚠️ *Error Loading Users*

Unable to load the user list right now. Please try again later.`);
      return;
    }

    if (!users || users.length === 0) {
      await sendMessage(from, `📋 *User List*

No users are currently registered in the system.`);
      return;
    }

    // Sort users: Admins first, then users, both alphabetically
    const sortedUsers = users.sort((a, b) => {
      if (a.bot_userrole === b.bot_userrole) {
        return a.bot_username.localeCompare(b.bot_username);
      }
      return a.bot_userrole === 'ADMIN' ? -1 : 1;
    });

    // Build user list message
    let message = `📋 *Registered Users (${sortedUsers.length})*\n\n`;
    
    sortedUsers.forEach((user, index) => {
      const phoneFormatted = formatPhoneNumber(user.bot_userphone);
      const roleIcon = user.bot_userrole === 'ADMIN' ? '👨‍💼' : '👤';
      
      message += `${roleIcon} *${user.bot_username}*\n`;
      message += `   📱 ${phoneFormatted}\n`;
      message += `   🏷️ ${user.bot_userrole}\n`;
      
      if (index < sortedUsers.length - 1) {
        message += '\n';
      }
    });

    await sendMessage(from, message);

  } catch (error) {
    console.error('List users error:', error);
    await sendMessage(from, `⚠️ *Error Loading Users*

Unable to load the user list right now. Please try again later.`);
  }
}

module.exports = handleListUsers;