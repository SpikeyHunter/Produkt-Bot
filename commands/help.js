// commands/help.js - Updated with unregistered user handling
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');

async function handleHelp(from, user = null) {
  try {
    let templateKey = 'unregistered';
    
    if (user) {
      templateKey = user.bot_userrole === 'ADMIN' ? 'admin' : 'user';
    }

    const helpTemplates = templates.get('help');
    const helpMessage = helpTemplates[templateKey];
    
    await sendMessage(from, helpMessage);
  } catch (error) {
    console.error('Help command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

module.exports = handleHelp;