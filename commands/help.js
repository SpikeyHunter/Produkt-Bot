// commands/help.js - Dynamic help with role-based commands inserted into Tixr section (no role descriptions)
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');

// Define role-specific commands that get inserted under Tixr Commands
const roleCommands = {
  'NCGCOUNT': {
    section: "NCG Count Commands",
    commands: [
      "🔹 *count* - NCG venue counting tools",
      "🔹 *analytics* - NCG event analytics"
    ]
  },
  'OPENTABLE': {
    section: "OpenTable Commands", 
    commands: [
      "🔹 *reservations* - Manage restaurant reservations",
      "🔹 *tables* - Table management system"
    ]
  },
  'MANAGERSALES': {
    section: "Manager Sales Commands",
    commands: [
      "🔹 *reports* - Generate detailed sales reports", 
      "🔹 *revenue* - Advanced revenue analytics"
    ]
  }
};

async function handleHelp(from, user = null) {
  try {
    if (!user) {
      // Unregistered user
      const helpTemplates = templates.get('help');
      await sendMessage(from, helpTemplates.unregistered);
      return;
    }

    // Get base help for primary role
    const templateKey = user.bot_userrole === 'ADMIN' ? 'admin' : 'user';
    const helpTemplates = templates.get('help');
    let helpLines = helpTemplates[templateKey].split('\n');

    // Find where to insert role-specific commands (after promoter line)
    const promoterIndex = helpLines.findIndex(line => line.includes('*promoter*'));
    
    if (promoterIndex !== -1 && user.bot_secondary_roles) {
      const secondaryRoles = user.bot_secondary_roles.split(',').filter(role => role.trim() !== '');
      
      if (secondaryRoles.length > 0) {
        let insertIndex = promoterIndex + 1;
        
        // Add role-specific command sections
        secondaryRoles.forEach(roleKey => {
          const roleConfig = roleCommands[roleKey];
          if (roleConfig) {
            // Add empty line, section header, and commands
            helpLines.splice(insertIndex, 0, "");
            insertIndex++;
            helpLines.splice(insertIndex, 0, roleConfig.section);
            insertIndex++;
            
            roleConfig.commands.forEach(command => {
              helpLines.splice(insertIndex, 0, command);
              insertIndex++;
            });
          }
        });
      }
    }

    // Join the lines back together and send
    const finalHelpMessage = helpLines.join('\n');
    await sendMessage(from, finalHelpMessage);
    
  } catch (error) {
    console.error('Help command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
  }
}

module.exports = handleHelp;