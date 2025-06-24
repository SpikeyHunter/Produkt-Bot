// commands/help.js - Updated to use templates
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');

async function handleHelp(from, user = null) {
  try {
    let templateKey = 'general';
    
    if (user) {
      templateKey = user.bot_userrole === 'ADMIN' ? 'admin' : 'user';
    }

    const helpMessages = templates.get('help');
    const helpMessage = helpMessages[templateKey];
    
    await sendMessage(from, helpMessage);
  } catch (error) {
    console.error('Help command error:', error);
    const errorMessage = templates.get('general').technicalIssue;
    await sendMessage(from, errorMessage);
  }
}

module.exports = handleHelp;