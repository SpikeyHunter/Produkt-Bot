// commands/help.js - Updated with role-based help and secondary roles
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');

async function handleHelp(from, user = null) {
  try {
    let helpMessage = '';
    
    if (!user) {
      // Unregistered user
      const helpTemplates = templates.get('help');
      await sendMessage(from, helpTemplates.unregistered);
      return;
    }

    // Get base help for primary role
    const templateKey = user.bot_userrole === 'ADMIN' ? 'admin' : 'user';
    const helpTemplates = templates.get('help');
    helpMessage = helpTemplates[templateKey];

    // Add secondary role information if user has any
    if (user.bot_secondary_roles) {
      const secondaryRoles = user.bot_secondary_roles.split(',').filter(role => role.trim() !== '');
      
      if (secondaryRoles.length > 0) {
        helpMessage += "\n\n🎭 *Your Additional Roles:*\n";
        
        const roleDescriptions = {
          'NCGCOUNT': 'NCG Counter - New City Gas analytics access',
          'OPENTABLE': 'OpenTable Manager - Restaurant management',
          'MANAGERSALES': 'Sales Manager - Enhanced sales data including financials'
        };
        
        secondaryRoles.forEach(roleKey => {
          const description = roleDescriptions[roleKey] || `${roleKey} - Special access role`;
          helpMessage += `• ${description}\n`;
        });
        
        // Add note about enhanced features
        helpMessage += "\n💡 *Note:* Your additional roles provide enhanced access to existing commands.";
      }
    }

    await sendMessage(from, helpMessage);
    
  } catch (error) {
    console.error('Help command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

module.exports = handleHelp;