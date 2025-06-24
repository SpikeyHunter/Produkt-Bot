// commands/status.js - ZERO hardcoded messages
const { sendMessage, formatPhoneNumber } = require('../utils');
const templates = require('../templates/templateLoader');

async function handleStatus(from, user, parameter = '', supabase) {
  const statusTemplates = templates.get('status');
  const generalTemplates = templates.get('general');

  if (!user) {
    await sendMessage(from, statusTemplates.unregistered);
    return;
  }

  // If no parameter, show user's own status
  if (!parameter) {
    const statusMessage = templates.get('status', {
      username: user.bot_username,
      role: user.bot_userrole,
      phone: formatPhoneNumber(user.bot_userphone)
    }).userStatus;
    
    await sendMessage(from, statusMessage);
    return;
  }

  // Parameter provided - admin checking another user
  if (user.bot_userrole !== 'ADMIN') {
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
      await sendMessage(from, generalTemplates.technicalIssue);
      return;
    }

    if (!targetUser) {
      const userNotFoundMessage = templates.get('status', { username: parameter }).userNotFound;
      await sendMessage(from, userNotFoundMessage);
      return;
    }

    const statusMessage = templates.get('status', {
      username: targetUser.bot_username,
      role: targetUser.bot_userrole,
      phone: formatPhoneNumber(targetUser.bot_userphone)
    }).otherUserStatus;

    await sendMessage(from, statusMessage);

  } catch (error) {
    console.error('Status command error:', error);
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

module.exports = handleStatus;