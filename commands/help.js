// commands/help.js - Fixed: User secondary roles show + Admin sees all role commands
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

    // Find where to insert role-specific commands (after sales/promoter line)
    let insertAfterIndex = -1;
    
    // For admin, look for promoter line, for user look for sales line
    if (user.bot_userrole === 'ADMIN') {
      insertAfterIndex = helpLines.findIndex(line => line.includes('*promoter*'));
    } else {
      insertAfterIndex = helpLines.findIndex(line => line.includes('*sales*'));
    }
    
    if (insertAfterIndex !== -1) {
      // Determine which roles to show
      let rolesToShow = [];
      
      if (user.bot_userrole === 'ADMIN') {
        // ADMIN sees ALL role commands regardless of their secondary roles
        rolesToShow = Object.keys(roleCommands);
        console.log(`Admin user - showing all role commands: ${rolesToShow.join(', ')}`);
      } else if (user.bot_secondary_roles) {
        // Regular users only see their assigned secondary roles
        rolesToShow = user.bot_secondary_roles.split(',').filter(role => role.trim() !== '');
        console.log(`User with secondary roles: ${rolesToShow.join(', ')}`);
      }
      
      if (rolesToShow.length > 0) {
        let insertIndex = insertAfterIndex + 1;
        
        // Add role-specific command sections
        rolesToShow.forEach(roleKey => {
          const roleConfig = roleCommands[roleKey];
          if (roleConfig) {
            console.log(`Adding section: ${roleConfig.section}`);
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