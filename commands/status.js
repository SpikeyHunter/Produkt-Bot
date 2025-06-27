// commands/status.js - Updated to show secondary roles
const { sendMessage, formatPhoneNumber } = require('../utils');
const templates = require('../templates/templateLoader');

function getFormattedUserRoles(user) {
  if (!user) return 'No roles';
  
  let roleList = [];
  
  // Add primary role
  roleList.push(`${user.bot_userrole} (Primary)`);
  
  // Add secondary roles
  if (user.bot_secondary_roles) {
    const secondaryRoles = user.bot_secondary_roles.split(',').filter(role => role.trim() !== '');
    
    const roleNames = {
      'NCGCOUNT': 'NCG Counter',
      'OPENTABLE': 'OpenTable Manager',
      'MANAGERSALES': 'Sales Manager'
    };
    
    secondaryRoles.forEach(roleKey => {
      const roleName = roleNames[roleKey] || roleKey;
      roleList.push(roleName);
    });
  }
  
  return roleList.join(', ');
}

async function handleStatus(from, user, parameter = '', supabase) {
  if (!user) {
    const statusTemplates = templates.get('status');
    await sendMessage(from, statusTemplates.unregistered);
    return;
  }

  // If no parameter, show user's own status
  if (!parameter) {
    const formattedRoles = getFormattedUserRoles(user);
    
    let statusMessage = `📊 *Your Status*\n\n`;
    statusMessage += `👤 *Name:* ${user.bot_username}\n`;
    statusMessage += `🏷️ *Primary Role:* ${user.bot_userrole}\n`;
    statusMessage += `🎭 *All Roles:* ${formattedRoles}\n`;
    statusMessage += `📱 *Phone:* ${formatPhoneNumber(user.bot_userphone)}\n`;
    statusMessage += `🌍 *Timezone:* ${user.bot_user_timezone || 'Not set'}\n`;
    statusMessage += `✅ *Status:* Active\n\n`;
    statusMessage += `You're all set up and ready to go!`;
    
    await sendMessage(from, statusMessage);
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

    const formattedRoles = getFormattedUserRoles(targetUser);
    
    let statusMessage = `📊 *User Status*\n\n`;
    statusMessage += `👤 *Name:* ${targetUser.bot_username}\n`;
    statusMessage += `🏷️ *Primary Role:* ${targetUser.bot_userrole}\n`;
    statusMessage += `🎭 *All Roles:* ${formattedRoles}\n`;
    statusMessage += `📱 *Phone:* ${formatPhoneNumber(targetUser.bot_userphone)}\n`;
    statusMessage += `🌍 *Timezone:* ${targetUser.bot_user_timezone || 'Not set'}\n`;
    statusMessage += `✅ *Status:* Active`;

    await sendMessage(from, statusMessage);

  } catch (error) {
    console.error('Status command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

module.exports = handleStatus;