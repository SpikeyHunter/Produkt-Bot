// commands/role.js - Role management system
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');
const permissions = require('../config/permissions.json');

async function handleRole(from, text, roleState, supabase, user) {
  if (!user) {
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.welcomeUnregistered);
    return roleState;
  }

  if (!roleState[from]) {
    // Start role management flow
    roleState[from] = { step: 1 };
    const roleTemplates = templates.get('role');
    await sendMessage(from, roleTemplates.welcome);
    return roleState;
  }

  if (roleState[from].step === 1) {
    // Handle role selection
    const input = text.toLowerCase().trim();
    
    if (input === 'cancel') {
      delete roleState[from];
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.canceled);
      return roleState;
    }

    // Check which role they want
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
    roleState[from].step = 2;
    
    const roleInfo = permissions.secondaryRoles[selectedRole];
    const roleTemplates = templates.get('role', { 
      roleName: roleInfo.name,
      roleDescription: roleInfo.description 
    });
    await sendMessage(from, roleTemplates.askPassword);
    return roleState;
  }

  if (roleState[from].step === 2) {
    // Handle password verification
    const password = text.trim();
    const selectedRole = roleState[from].selectedRole;
    
    if (password.toLowerCase() === 'cancel') {
      delete roleState[from];
      const roleTemplates = templates.get('role');
      await sendMessage(from, roleTemplates.canceled);
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
      // Get current user roles (assuming they're stored as comma-separated string or array)
      const currentRoles = user.bot_secondary_roles ? user.bot_secondary_roles.split(',') : [];
      
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
        .eq('bot_userphone', from);

      if (error) {
        console.error('Error updating user roles:', error);
        const generalTemplates = templates.get('general');
        await sendMessage(from, generalTemplates.technicalIssue);
      } else {
        const roleInfo = permissions.secondaryRoles[selectedRole];
        const roleTemplates = templates.get('role', { 
          roleName: roleInfo.name,
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

  return roleState;
}

module.exports = handleRole;