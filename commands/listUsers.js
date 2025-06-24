// commands/listUsers.js - ZERO hardcoded messages
const { sendMessage, formatPhoneNumber } = require('../utils');
const templates = require('../templates/templateLoader');

async function handleListUsers(from, supabase) {
  try {
    const listUsersTemplates = templates.get('listUsers');
    const generalTemplates = templates.get('general');
    
    // Get all registered users
    const { data: users, error } = await supabase
      .from('bot_users')
      .select('bot_username, bot_userphone, bot_userrole')
      .order('bot_username');

    if (error) {
      console.error('Error fetching users:', error);
      await sendMessage(from, generalTemplates.technicalIssue);
      return;
    }

    if (!users || users.length === 0) {
      await sendMessage(from, listUsersTemplates.noUsers);
      return;
    }

    // Sort users: Admins first, then users, both alphabetically
    const sortedUsers = users.sort((a, b) => {
      if (a.bot_userrole === b.bot_userrole) {
        return a.bot_username.localeCompare(b.bot_username);
      }
      return a.bot_userrole === 'ADMIN' ? -1 : 1;
    });

    // Build user list message using templates
    const headerMessage = templates.get('listUsers', { count: sortedUsers.length }).header;
    let message = headerMessage + '\n\n';
    
    sortedUsers.forEach((user, index) => {
      const phoneFormatted = formatPhoneNumber(user.bot_userphone);
      const roleIcon = user.bot_userrole === 'ADMIN' ? '👨‍💼' : '👤';
      
      const userEntry = templates.get('listUsers', {
        icon: roleIcon,
        username: user.bot_username,
        phone: phoneFormatted,
        role: user.bot_userrole
      }).userEntry;
      
      message += userEntry;
      
      if (index < sortedUsers.length - 1) {
        message += '\n\n';
      }
    });

    await sendMessage(from, message);

  } catch (error) {
    console.error('List users error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

module.exports = handleListUsers;