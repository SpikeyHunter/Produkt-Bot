// commands/status.js - ACTUALLY working with variables
const { sendMessage, formatPhoneNumber } = require('../utils');
const templates = require('../templates/templateLoader');

async function handleStatus(from, user, parameter = '', supabase) {
  if (!user) {
    const statusTemplates = templates.get('status');
    await sendMessage(from, statusTemplates.unregistered);
    return;
  }

  // If no parameter, show user's own status
  if (!parameter) {
    const statusTemplates = templates.get('status', {
      username: user.bot_username,
      role: user.bot_userrole,
      phone: formatPhoneNumber(user.bot_userphone)
    });
    
    await sendMessage(from, statusTemplates.userStatus);
    return;
  }

  // Parameter provided - admin checking another user
  if (user.bot_userrole !== 'ADMIN') {
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.accessDenied);
    return;
  }

  try {
    // Search for user by username using existing supabase query
    const { data: targetUser, error } = await supabase
      .from('bot_users')
      .select('*')
      .ilike('bot_username', parameter)
      .maybeSingle();

    if (error) {
      console.error('Error searching for user:', error);
      const generalTemplates = templates.get('general');
      await sendMessage(from, generalTemplates.technicalIssue);
      return;
    }

    if (!targetUser) {
      const statusTemplates = templates.get('status', { username: parameter });
      await sendMessage(from, statusTemplates.userNotFound);
      return;
    }

    const statusTemplates = templates.get('status', {
      username: targetUser.bot_username,
      role: targetUser.bot_userrole,
      phone: formatPhoneNumber(targetUser.bot_userphone)
    });

    await sendMessage(from, statusTemplates.otherUserStatus);

  } catch (error) {
    console.error('Status command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

module.exports = handleStatus;