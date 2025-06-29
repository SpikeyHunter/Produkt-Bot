// botbasic.js - Unified command handler for all bot commands with command tracking
const { sendMessage, sendMessageInstant, formatPhoneNumber, getCommandStats } = require('../utils'); // FIXED: Go up one directory
const templates = require('../templates/templateLoader'); // FIXED: Go up one directory
const database = require('../scripts/database'); // FIXED: Go up one directory
const permissions = require('../config/permissions.json'); // FIXED: Go up one directory

// Permission checking function
function hasFeaturePermission(user, feature) {
  if (!user) return false;
  
  // Admin override - admins get all permissions
  if (user.bot_userrole === 'ADMIN') {
    return true;
  }
  
  // For view_gross_net_sales, check if user has MANAGERSALES role
  if (feature === 'view_gross_net_sales') {
    if (!user.bot_secondary_roles) return false;
    const userSecondaryRoles = user.bot_secondary_roles.split(',');
    return userSecondaryRoles.includes('MANAGERSALES');
  }
  
  return false;
}

// Helper function to get formatted user roles
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

// Helper function to format currency
function formatCurrency(amount) {
  if (!amount || amount === 0) return null;
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// REGISTER COMMAND
async function handleRegister(from, text, registrationState, supabase) {
  const { ADMIN_PASSWORD, USER_PASSWORD } = process.env;
  
  if (!registrationState[from]) {
    // Start registration process
    registrationState[from] = { step: 1 };
    const botbasicTemplates = templates.get('botbasic');
    await sendMessage(from, botbasicTemplates.registrationWelcome);
    return registrationState;
  }

  if (registrationState[from].step === 1) {
    // Handle name input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.registrationCanceled);
      return registrationState;
    }

    registrationState[from].username = text;
    registrationState[from].step = 2;
    const botbasicTemplates = templates.get('botbasic', { name: text });
    await sendMessage(from, botbasicTemplates.registrationStep2);
    return registrationState;
  }

  if (registrationState[from].step === 2) {
    // Handle password input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.registrationCanceled);
      return registrationState;
    }

    const password = text;
    let role = '';

    if (password === ADMIN_PASSWORD) {
      role = 'ADMIN';
    } else if (password === USER_PASSWORD) {
      role = 'USER';
    } else {
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.registrationWrongPassword);
      return registrationState;
    }

    registrationState[from].role = role;
    registrationState[from].step = 3;
    const botbasicTemplates = templates.get('botbasic');
    await sendMessage(from, botbasicTemplates.registrationStep3);
    return registrationState;
  }

  if (registrationState[from].step === 3) {
    // Handle timezone selection
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.registrationCanceled);
      return registrationState;
    }

    const input = text.toLowerCase().trim();
    let timezone = '';
    let timezoneName = '';

    if (input === '1' || input === 'montreal' || input === 'eastern') {
      timezone = 'America/New_York';
      timezoneName = 'Montreal (Eastern)';
    } else if (input === '2' || input === 'la' || input === 'los angeles' || input === 'pacific') {
      timezone = 'America/Los_Angeles';
      timezoneName = 'Los Angeles (Pacific)';
    } else if (input === '3' || input === 'other' || input === 'utc') {
      timezone = 'UTC';
      timezoneName = 'UTC (Other)';
    } else {
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.registrationInvalidTimezone);
      return registrationState;
    }

    // Save to database
    try {
      const result = await database.registerUser(
        from, 
        registrationState[from].username, 
        registrationState[from].role,
        timezone
      );
      
      if (result.success) {
        const botbasicTemplates = templates.get('botbasic', {
          name: registrationState[from].username,
          role: registrationState[from].role,
          timezone: timezoneName
        });
        await sendMessage(from, botbasicTemplates.registrationSuccess);
      } else {
        const botbasicTemplates = templates.get('botbasic');
        await sendMessage(from, botbasicTemplates.registrationFailed);
      }
    } catch (error) {
      console.error('Registration error:', error);
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.registrationFailed);
    }

    delete registrationState[from];
    return registrationState;
  }

  return registrationState;
}

// STATUS COMMAND
async function handleStatus(from, user, parameter = '', supabase) {
  if (!user) {
    const botbasicTemplates = templates.get('botbasic');
    await sendMessage(from, botbasicTemplates.statusUnregistered);
    return;
  }

  // If no parameter, show user's own status
  if (!parameter) {
    const formattedRoles = getFormattedUserRoles(user);
    
    // Get command statistics
    const commandStats = await getCommandStats(user.bot_userphone, supabase);
    
    let statusMessage = `📊 *Your Status*\n\n`;
    statusMessage += `👤 *Name:* ${user.bot_username}\n`;
    statusMessage += `🏷️ *Primary Role:* ${user.bot_userrole}\n`;
    statusMessage += `🎭 *All Roles:* ${formattedRoles}\n`;
    statusMessage += `📱 *Phone:* ${formatPhoneNumber(user.bot_userphone)}\n`;
    statusMessage += `🌍 *Timezone:* ${user.bot_user_timezone || 'Not set'}\n`;
    statusMessage += `📈 *Commands Used:* ${commandStats.totalCommands}\n`;
    statusMessage += `✅ *Status:* Active\n\n`;
    
    if (commandStats.lastCommand) {
      const lastCommandDate = new Date(commandStats.lastCommand.timestamp);
      const formattedDate = lastCommandDate.toLocaleDateString();
      const formattedTime = lastCommandDate.toLocaleTimeString();
      statusMessage += `🕒 *Last Command:* ${commandStats.lastCommand.command} on ${formattedDate} at ${formattedTime}\n\n`;
    }
    
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
    // Search for user by username
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
      const botbasicTemplates = templates.get('botbasic', { username: parameter });
      await sendMessage(from, botbasicTemplates.statusUserNotFound);
      return;
    }

    const formattedRoles = getFormattedUserRoles(targetUser);
    
    // Get command statistics for target user
    const commandStats = await getCommandStats(targetUser.bot_userphone, supabase);
    
    let statusMessage = `📊 *User Status*\n\n`;
    statusMessage += `👤 *Name:* ${targetUser.bot_username}\n`;
    statusMessage += `🏷️ *Primary Role:* ${targetUser.bot_userrole}\n`;
    statusMessage += `🎭 *All Roles:* ${formattedRoles}\n`;
    statusMessage += `📱 *Phone:* ${formatPhoneNumber(targetUser.bot_userphone)}\n`;
    statusMessage += `🌍 *Timezone:* ${targetUser.bot_user_timezone || 'Not set'}\n`;
    statusMessage += `📈 *Commands Used:* ${commandStats.totalCommands}\n`;
    statusMessage += `✅ *Status:* Active`;
    
    if (commandStats.lastCommand) {
      const lastCommandDate = new Date(commandStats.lastCommand.timestamp);
      const formattedDate = lastCommandDate.toLocaleDateString();
      const formattedTime = lastCommandDate.toLocaleTimeString();
      statusMessage += `\n🕒 *Last Command:* ${commandStats.lastCommand.command} on ${formattedDate} at ${formattedTime}`;
    }

    await sendMessage(from, statusMessage);

  } catch (error) {
    console.error('Status command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

// UNREGISTER COMMAND
async function handleUnregister(from, text, confirmationState, supabase, user, targetUsername = '') {
  try {
    const generalTemplates = templates.get('general');

    // Check if user is in confirmation state
    if (!confirmationState[from]) {
      // Admin trying to delete another user
      if (targetUsername && user.bot_userrole === 'ADMIN') {
        // Search for target user
        const { data: targetUser, error } = await supabase
          .from('bot_users')
          .select('*')
          .ilike('bot_username', targetUsername)
          .maybeSingle();

        if (error) {
          console.error('Error searching for user:', error);
          await sendMessage(from, generalTemplates.technicalIssue);
          return confirmationState;
        }

        if (!targetUser) {
          const botbasicTemplates = templates.get('botbasic', { username: targetUsername });
          await sendMessage(from, botbasicTemplates.unregisterUserNotFound);
          return confirmationState;
        }

        // Prevent admin from deleting another admin
        if (targetUser.bot_userrole === 'ADMIN') {
          const botbasicTemplates = templates.get('botbasic');
          await sendMessage(from, botbasicTemplates.unregisterCannotDeleteAdmin);
          return confirmationState;
        }

        // Start confirmation for deleting another user
        confirmationState[from] = { 
          action: 'unregister', 
          targetUser: targetUser,
          timestamp: Date.now() 
        };
        
        const botbasicTemplates = templates.get('botbasic', { username: targetUser.bot_username });
        await sendMessage(from, botbasicTemplates.unregisterConfirmOther);
        return confirmationState;
      }
      
      // Regular user or admin deleting themselves
      if (targetUsername && user.bot_userrole !== 'ADMIN') {
        await sendMessage(from, generalTemplates.accessDenied);
        return confirmationState;
      }

      // Start confirmation for self-deletion
      confirmationState[from] = { 
        action: 'unregister', 
        targetUser: null, // null means self-deletion
        timestamp: Date.now() 
      };
      
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.unregisterConfirmSelf);
      return confirmationState;
    }

    // Handle confirmation response
    const response = text.toLowerCase().trim();
    
    if (response === 'yes' || response === 'confirm') {
      const isAdminDeletingOther = confirmationState[from].targetUser !== null;
      const userToDelete = isAdminDeletingOther ? confirmationState[from].targetUser : user;

      // Delete the user from database
      const { error } = await supabase
        .from('bot_users')
        .delete()
        .eq('bot_userphone', userToDelete.bot_userphone);

      if (error) {
        console.error('Unregister delete error:', error);
        await sendMessage(from, generalTemplates.technicalIssue);
      } else {
        if (isAdminDeletingOther) {
          const botbasicTemplates = templates.get('botbasic', { username: userToDelete.bot_username });
          await sendMessage(from, botbasicTemplates.unregisterSuccessOther);
        } else {
          const botbasicTemplates = templates.get('botbasic');
          await sendMessage(from, botbasicTemplates.unregisterSuccessSelf);
        }
      }
      
      delete confirmationState[from];
    } else if (response === 'no' || response === 'cancel') {
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.unregisterCanceled);
      delete confirmationState[from];
    } else {
      // Invalid response
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.unregisterInvalidResponse);
    }

    return confirmationState;
  } catch (error) {
    console.error('Unregister error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
    delete confirmationState[from];
    return confirmationState;
  }
}

// LIST USERS COMMAND
async function handleListUsers(from, supabase) {
  try {
    const generalTemplates = templates.get('general');
    
    // Get all registered users
    const { data: users, error } = await supabase
      .from('bot_users')
      .select('bot_username, bot_userphone, bot_userrole, bot_command_use')
      .order('bot_username');

    if (error) {
      console.error('Error fetching users:', error);
      await sendMessage(from, generalTemplates.technicalIssue);
      return;
    }

    if (!users || users.length === 0) {
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.listUsersNoUsers);
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
      const commandCount = user.bot_command_use || 0;
      
      message += `${roleIcon} *${user.bot_username}*\n   📱 ${phoneFormatted}\n   🏷️ ${user.bot_userrole}\n   📈 ${commandCount} commands`;
      
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

// TIMEZONE COMMAND
async function handleTimezone(from, text, timezoneState, supabase, user) {
  // Only registered users can change timezone
  if (!user) {
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.welcomeUnregistered);
    return timezoneState;
  }

  if (!timezoneState[from]) {
    // Start timezone change process
    timezoneState[from] = { step: 1 };
    const currentTz = database.getTimezoneName(user.bot_user_timezone);
    const botbasicTemplates = templates.get('botbasic', { currentTimezone: currentTz });
    await sendMessage(from, botbasicTemplates.timezonePrompt);
    return timezoneState;
  }

  if (timezoneState[from].step === 1) {
    // Handle timezone selection
    if (text.toLowerCase() === 'cancel') {
      delete timezoneState[from];
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.timezoneCanceled);
      return timezoneState;
    }

    const input = text.toLowerCase().trim();
    let timezone = '';
    let timezoneName = '';

    if (input === '1' || input === 'montreal' || input === 'eastern') {
      timezone = 'America/New_York';
      timezoneName = 'Montreal (Eastern)';
    } else if (input === '2' || input === 'la' || input === 'los angeles' || input === 'pacific') {
      timezone = 'America/Los_Angeles';
      timezoneName = 'Los Angeles (Pacific)';
    } else if (input === '3' || input === 'other' || input === 'utc') {
      timezone = 'UTC';
      timezoneName = 'UTC (Other)';
    } else {
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.timezoneInvalid);
      return timezoneState;
    }

    // Check if it's the same timezone
    if (timezone === user.bot_user_timezone) {
      const botbasicTemplates = templates.get('botbasic', { timezone: timezoneName });
      await sendMessage(from, botbasicTemplates.timezoneUnchanged);
      delete timezoneState[from];
      return timezoneState;
    }

    // Update timezone in database
    try {
      const result = await database.updateUserTimezone(from, timezone);
      
      if (result.success) {
        const botbasicTemplates = templates.get('botbasic', { 
          timezone: timezoneName,
          oldTimezone: database.getTimezoneName(user.bot_user_timezone)
        });
        await sendMessage(from, botbasicTemplates.timezoneSuccess);
      } else {
        const botbasicTemplates = templates.get('botbasic');
        await sendMessage(from, botbasicTemplates.timezoneFailed);
      }
    } catch (error) {
      console.error('Timezone update error:', error);
      const botbasicTemplates = templates.get('botbasic');
      await sendMessage(from, botbasicTemplates.timezoneFailed);
    }

    delete timezoneState[from];
    return timezoneState;
  }

  return timezoneState;
}

// PASSWORD COMMAND
async function handlePassword(from, user) {
  // Check if user is admin
  if (!user || user.bot_userrole !== 'ADMIN') {
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.accessDenied);
    return;
  }

  try {
    // Build password list
    let passwordMessage = "🔐 *Role Passwords*\n\n";
    passwordMessage += "*Primary Roles:*\n";
    passwordMessage += `👤 User: ${process.env.USER_PASSWORD || 'Not Set'}\n`;
    passwordMessage += `👨‍💼 Admin: ${process.env.ADMIN_PASSWORD || 'Not Set'}\n\n`;
    
    passwordMessage += "*Secondary Roles:*\n";
    passwordMessage += `🎯 NCG Count: ${process.env.NCGCOUNT_PASSWORD || 'Not Set'}\n`;
    passwordMessage += `🍽️ OpenTable: ${process.env.OPENTABLE_PASSWORD || 'Not Set'}\n`;
    passwordMessage += `📊 Manager Sales: ${process.env.MANAGERSALES_PASSWORD || 'Not Set'}\n\n`;
    
    passwordMessage += "⚠️ *Keep these passwords secure!*";

    await sendMessage(from, passwordMessage);

  } catch (error) {
    console.error('Password command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

// Export all handlers
module.exports = {
  handleRegister,
  handleStatus,
  handleUnregister,
  handleListUsers,
  handleTimezone,
  handlePassword,
  hasFeaturePermission,
  getFormattedUserRoles,
  formatCurrency
};