// commands/password.js - Admin command to view all role passwords
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');

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

module.exports = handlePassword;