// commands/role.js - Enhanced role management system with add/remove functionality
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');
const permissions = require('../config/permissions.json');

async function handleRole(from, text, roleState, supabase, user, parameter = '') {
  if (!user) {
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.welcomeUnregistered);
    return roleState;
  }

  if (!roleState[from]) {
    // Start role management flow
    roleState[from] = { step: 'main_menu' };
    
    // Admin managing another user's roles
    if (user.bot_userrole === 'ADMIN' && parameter) {
      roleState[from].targetUsername = parameter;
      roleState[from].isAdminManagement = true;
      
      // Find the target user
      try {
        const { data: targetUser, error } = await supabase
          .from('bot_users')
          .select('*')
          .ilike('bot_username', parameter)
          .maybeSingle();

        if (error) {
          console.error('Error finding target user:', error);
          delete roleState[from];
          const generalTemplates = templates.get('general');
          await sendMessage(from, generalTemplates.technicalIssue);
          return roleState;
        }

        if (!targetUser) {
          delete roleState[from];
          const roleTemplates = templates.get('role', { username: parameter });
          await sendMessage(from, roleTemplates.userNotFound);
          return roleState;
        }

        roleState[from].targetUser = targetUser;
        
        // Show admin menu for target user
        const roleTemplates = templates.get('role', { 
          username: targetUser.bot_username,
          hasRoles: targetUser.bot_secondary_roles ? 'true' : 'false'
        });
        await sendMessage(from, roleTemplates.adminMenu);
        return roleState;
        
      } catch (error) {
        console.error('Error in admin role management:', error);
        delete roleState[from];
        const generalTemplates = templates.get('general');
        await sendMessage(from, generalTemplates.technicalIssue);
        return roleState;
      }
    }
    
    // User managing their own roles
    else {
      const roleTemplates = templates.get('role', { 
        hasRoles: user.bot_secondary_roles ? 'true' : 'false' 
      });
      await sendMessage(from, roleTemplates.userMenu);
      return roleState;
    }
  }

  if (roleState[from].step === 'main_menu') {
    // Handle main menu selection
    const input = text.toLowerCase().trim();
    
    if (input === 'cancel') {
      delete roleState[from];
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.canceled);
      return roleState;
    }

    if (input === '1' || input === 'add') {
      roleState[from].step = 'add_role';
      roleState[from].action = 'add';
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.addWelcome);
      return roleState;
    }

    if (input === '2' || input === 'remove') {
      // Check if user (or target user) has roles to remove
      const targetUser = roleState[from].isAdminManagement ? roleState[from].targetUser : user;
      
      if (!targetUser.bot_secondary_roles) {
        delete roleState[from];
        const roleTemplates = templates.get('role', { 
          username: roleState[from].isAdminManagement ? targetUser.bot_username : 'You' 
        });
        await sendMessage(from, roleTemplates.noRolesToRemove);
        return roleState;
      }

      roleState[from].step = 'remove_role';
      roleState[from].action = 'remove';
      
      // Show current roles for removal
      const userRoles = targetUser.bot_secondary_roles.split(',').filter(role => role.trim() !== '');
      let rolesMessage = roleState[from].isAdminManagement 
        ? `🎭 *Remove Roles from ${targetUser.bot_username}*\n\n`
        : `🎭 *Remove Your Secondary Roles*\n\n`;
      
      rolesMessage += `Current secondary roles:\n\n`;
      
      userRoles.forEach((roleKey, index) => {
        const roleInfo = permissions.secondaryRoles[roleKey];
        if (roleInfo) {
          rolesMessage += `${index + 1}️⃣ *${roleInfo.name}* - ${roleInfo.description}\n`;
        }
      });
      
      rolesMessage += `\nSelect a role to remove by typing the number, or type *cancel* to go back.`;
      await sendMessage(from, rolesMessage);
      
      roleState[from].availableRoles = userRoles;
      return roleState;
    }

    // Invalid main menu selection
    const roleTemplates = templates.get('role');
    await sendMessage(from, roleTemplates.invalidMainMenu);
    return roleState;
  }

  if (roleState[from].step === 'add_role') {
    // Handle role addition (existing logic)
    const input = text.toLowerCase().trim();
    
    if (input === 'cancel') {
      // Go back to main menu
      roleState[from].step = 'main_menu';
      const roleTemplates = templates.get('role', { 
        hasRoles: (roleState[from].isAdminManagement ? roleState[from].targetUser : user).bot_secondary_roles ? 'true' : 'false' 
      });
      const menuTemplate = roleState[from].isAdminManagement ? 'adminMenu' : 'userMenu';
      await sendMessage(from, roleTemplates[menuTemplate]);
      return roleState;
    }

    // Check which role they want to add
    let selectedRole = null;
    if (input === '1' || input === 'ncgcount' || input === 'ncg') {
      selectedRole = 'NCGCOUNT';
    } else if (input === '2' || input === 'opentable' || input === 'ot') {
      selectedRole = 'OPENTABLE';
    } else if (input === '3' || input === 'managersales' || input === 'manager' || input === 'sales') {
      selectedRole = 'MANAGERSALES';
    } else {
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.invalidSelection);
      return roleState;
    }

    roleState[from].selectedRole = selectedRole;
    roleState[from].step = 'password';
    
    const roleInfo = permissions.secondaryRoles[selectedRole];
    const roleTemplates = templates.get('role', { 
      roleName: roleInfo.name,
      roleDescription: roleInfo.description 
    });
    await sendMessage(from, roleTemplates.askPassword);
    return roleState;
  }

  if (roleState[from].step === 'remove_role') {
    // Handle role removal selection
    const input = text.toLowerCase().trim();
    
    if (input === 'cancel') {
      // Go back to main menu
      roleState[from].step = 'main_menu';
      const roleTemplates = templates.get('role', { 
        hasRoles: (roleState[from].isAdminManagement ? roleState[from].targetUser : user).bot_secondary_roles ? 'true' : 'false' 
      });
      const menuTemplate = roleState[from].isAdminManagement ? 'adminMenu' : 'userMenu';
      await sendMessage(from, roleTemplates[menuTemplate]);
      return roleState;
    }

    const roleIndex = parseInt(input) - 1;
    const availableRoles = roleState[from].availableRoles;
    
    if (isNaN(roleIndex) || roleIndex < 0 || roleIndex >= availableRoles.length) {
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.invalidSelection);
      return roleState;
    }

    const selectedRole = availableRoles[roleIndex];
    const roleInfo = permissions.secondaryRoles[selectedRole];
    
    roleState[from].selectedRole = selectedRole;
    roleState[from].step = 'confirm_removal';
    
    // Show confirmation message
    const targetName = roleState[from].isAdminManagement 
      ? roleState[from].targetUser.bot_username 
      : 'your account';
      
    const roleTemplates = templates.get('role', {
      roleName: roleInfo.name,
      targetName: targetName
    });
    await sendMessage(from, roleTemplates.confirmRemoval);
    return roleState;
  }

  if (roleState[from].step === 'password') {
    // Handle password verification for adding roles
    const password = text.trim();
    const selectedRole = roleState[from].selectedRole;
    
    if (password.toLowerCase() === 'cancel') {
      // Go back to add role menu
      roleState[from].step = 'add_role';
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.addWelcome);
      return roleState;
    }

    // Check password against environment variables
    const envVarName = `${selectedRole}_PASSWORD`;
    const correctPassword = process.env[envVarName];
    
    if (!correctPassword) {
      console.error(`Environment variable ${envVarName} not found`);
      delete roleState[from];
      const generalTemplates = templates.get('general');
      await sendMessage(from, generalTemplates.technicalIssue);
      return roleState;
    }

    if (password !== correctPassword) {
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.wrongPassword);
      return roleState;
    }

    // Password correct - add role to user
    try {
      const targetUser = roleState[from].isAdminManagement ? roleState[from].targetUser : user;
      const currentRoles = targetUser.bot_secondary_roles ? targetUser.bot_secondary_roles.split(',') : [];
      
      // Check if user already has this role
      if (currentRoles.includes(selectedRole)) {
        const roleInfo = permissions.secondaryRoles[selectedRole];
        const roleTemplates = templates.get('role', { roleName: roleInfo.name });
        await sendMessage(from, roleTemplates.alreadyHasRole);
        delete roleState[from];
        return roleState;
      }

      // Add the new role
      currentRoles.push(selectedRole);
      const updatedRoles = currentRoles.join(',');

      // Update user in database
      const { error } = await supabase
        .from('bot_users')
        .update({ bot_secondary_roles: updatedRoles })
        .eq('bot_userphone', targetUser.bot_userphone);

      if (error) {
        console.error('Error updating user roles:', error);
        const generalTemplates = templates.get('general');
        await sendMessage(from, generalTemplates.technicalIssue);
      } else {
        const roleInfo = permissions.secondaryRoles[selectedRole];
        const targetName = roleState[from].isAdminManagement ? targetUser.bot_username : 'your account';
        const roleTemplates = templates.get('role', { 
          roleName: roleInfo.name,
          targetName: targetName,
          roleDescription: roleInfo.description,
          permissions: roleInfo.permissions.length > 0 ? roleInfo.permissions.join(', ') : 'Enhanced access to existing commands'
        });
        await sendMessage(from, roleTemplates.roleGranted);
      }
    } catch (error) {
      console.error('Role assignment error:', error);
      const generalTemplates = templates.get('general');
      await sendMessage(from, generalTemplates.technicalIssue);
    }

    delete roleState[from];
    return roleState;
  }

  if (roleState[from].step === 'confirm_removal') {
    // Handle removal confirmation
    const input = text.toLowerCase().trim();
    
    if (input === 'cancel' || input === 'no' || input === 'n') {
      // Go back to main menu
      roleState[from].step = 'main_menu';
      const roleTemplates = templates.get('role', { 
        hasRoles: (roleState[from].isAdminManagement ? roleState[from].targetUser : user).bot_secondary_roles ? 'true' : 'false' 
      });
      const menuTemplate = roleState[from].isAdminManagement ? 'adminMenu' : 'userMenu';
      await sendMessage(from, roleTemplates[menuTemplate]);
      return roleState;
    }

    if (input !== 'yes' && input !== 'y' && input !== 'confirm') {
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.invalidConfirmation);
      return roleState;
    }

    // Remove the role
    try {
      const selectedRole = roleState[from].selectedRole;
      const targetUser = roleState[from].isAdminManagement ? roleState[from].targetUser : user;

      // Get current roles and remove the selected one
      const currentRoles = targetUser.bot_secondary_roles 
        ? targetUser.bot_secondary_roles.split(',').filter(role => role.trim() !== '') 
        : [];
      
      const updatedRoles = currentRoles.filter(role => role !== selectedRole);
      const updatedRolesString = updatedRoles.length > 0 ? updatedRoles.join(',') : null;

      // Update database
      const { error } = await supabase
        .from('bot_users')
        .update({ bot_secondary_roles: updatedRolesString })
        .eq('bot_userphone', targetUser.bot_userphone);

      if (error) {
        console.error('Error removing role:', error);
        const generalTemplates = templates.get('general');
        await sendMessage(from, generalTemplates.technicalIssue);
      } else {
        const roleInfo = permissions.secondaryRoles[selectedRole];
        const targetName = roleState[from].isAdminManagement ? targetUser.bot_username : 'your account';
          
        const roleTemplates = templates.get('role', {
          roleName: roleInfo.name,
          targetName: targetName
        });
        await sendMessage(from, roleTemplates.roleRemoved);
      }
    } catch (error) {
      console.error('Role removal error:', error);
      const generalTemplates = templates.get('general');
      await sendMessage(from, generalTemplates.technicalIssue);
    }

    delete roleState[from];
    return roleState;
  }

  return roleState;
}

module.exports = handleRole;