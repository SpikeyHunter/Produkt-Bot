// commands/status.js - Status command handler with templates
const { sendMessage, formatPhoneNumber } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');

async function handleStatus(from, user, parameter = '', supabase) {
  if (!user) {
    const unregisteredMessage = `📊 *Your Status*

❌ You are not currently registered.

Type *register* to get started!`;
    await sendMessage(from, unregisteredMessage);
    return;
  }

  // If no parameter, show user's own status
  if (!parameter) {
    const statusMessage = `📊 *Your Status*

👤 *Name:* ${user.bot_username}
🏷️ *Role:* ${user.bot_userrole}
📱 *Phone:* ${formatPhoneNumber(user.bot_userphone)}
✅ *Status:* Active

You're all set up and ready to go!`;
    
    await sendMessage(from, statusMessage);
    return;
  }

  // Parameter provided - admin checking another user
  if (user.bot_userrole !== 'ADMIN') {
    const accessDeniedMessage = `❌ *Access Denied*

Only admins can check other users' status.

Type *help* to see your available commands.`;
    await sendMessage(from, accessDeniedMessage);
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
      await sendMessage(from, "⚠️ Technical issue. Please try again later.");
      return;
    }

    if (!targetUser) {
      const userNotFoundMessage = `❌ *User Not Found*

No user found with the name "${parameter}".

Use *list users* to see all registered users.`;
      await sendMessage(from, userNotFoundMessage);
      return;
    }

    const statusMessage = `📊 *User Status*

👤 *Name:* ${targetUser.bot_username}
🏷️ *Role:* ${targetUser.bot_userrole}
📱 *Phone:* ${formatPhoneNumber(targetUser.bot_userphone)}
✅ *Status:* Active`;

    await sendMessage(from, statusMessage);

  } catch (error) {
    console.error('Status command error:', error);
    await sendMessage(from, "😅 Something went wrong. Please try again!");
  }
}

module.exports = handleStatus;