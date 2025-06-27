// utils/permissionUtils.js - Utility functions for checking permissions
const permissions = require('../config/permissions.json');

/**
 * Check if user has permission to use a command
 * @param {object} user - User object from database
 * @param {string} command - Command name to check
 * @returns {boolean} Whether user has permission
 */
function hasCommandPermission(user, command) {
  if (!user) return false;
  
  const allowedRoles = permissions.commandPermissions[command];
  if (!allowedRoles) return false;
  
  // Allow all users for public commands
  if (allowedRoles.includes('*')) return true;
  
  // Check primary role
  if (allowedRoles.includes(user.bot_userrole)) return true;
  
  return false;
}

/**
 * Check if user has a specific feature permission
 * @param {object} user - User object from database
 * @param {string} feature - Feature permission to check
 * @returns {boolean} Whether user has the feature permission
 */
function hasFeaturePermission(user, feature) {
  if (!user) return false;
  
  const featureConfig = permissions.featurePermissions[feature];
  if (!featureConfig) return false;
  
  // Check for admin override - admins get all permissions
  if (featureConfig.adminOverride && user.bot_userrole === 'ADMIN') {
    return true;
  }
  
  // Check if user has any secondary roles that grant this permission
  const userSecondaryRoles = user.bot_secondary_roles ? user.bot_secondary_roles.split(',') : [];
  
  return featureConfig.roles.some(role => userSecondaryRoles.includes(role));
}

/**
 * Get user's secondary roles as an array
 * @param {object} user - User object from database
 * @returns {Array} Array of secondary role names
 */
function getUserSecondaryRoles(user) {
  if (!user || !user.bot_secondary_roles) return [];
  return user.bot_secondary_roles.split(',').filter(role => role.trim() !== '');
}

/**
 * Get formatted list of user's roles for display
 * @param {object} user - User object from database
 * @returns {string} Formatted role list
 */
function getFormattedUserRoles(user) {
  if (!user) return 'No roles';
  
  let roleList = [];
  
  // Add primary role
  const primaryRole = permissions.primaryRoles[user.bot_userrole];
  if (primaryRole) {
    roleList.push(`${primaryRole.name} (Primary)`);
  }
  
  // Add secondary roles
  const secondaryRoles = getUserSecondaryRoles(user);
  secondaryRoles.forEach(roleKey => {
    const roleInfo = permissions.secondaryRoles[roleKey];
    if (roleInfo) {
      roleList.push(roleInfo.name);
    }
  });
  
  return roleList.length > 0 ? roleList.join(', ') : 'Standard User';
}

/**
 * Generate help message based on user's roles and permissions
 * @param {object} user - User object from database
 * @returns {string} Customized help message
 */
function generateRoleBasedHelp(user) {
  if (!user) {
    return permissions.unregisteredHelp || "You need to register first. Type *register* to get started.";
  }

  let helpMessage = '';
  
  // Primary role commands
  const primaryRole = permissions.primaryRoles[user.bot_userrole];
  if (primaryRole) {
    if (user.bot_userrole === 'ADMIN') {
      helpMessage += "👨‍💼 *Admin Commands*\n\n";
      helpMessage += "🔹 *sales* - View event sales figures\n";
      helpMessage += "🔹 *promoter* - View promoter ticket data\n";
      helpMessage += "🔹 *timezone* - Change your timezone setting\n";
      helpMessage += "🔹 *help* - Show this help menu\n";
      helpMessage += "🔹 *status* - Check your current status\n";
      helpMessage += "🔹 *status <username>* - Check another user's status\n";
      helpMessage += "🔹 *role* - Request additional roles\n";
      helpMessage += "🔹 *unregister* - Remove your registration\n";
      helpMessage += "🔹 *unregister <username>* - Remove another user\n";
      helpMessage += "🔹 *list users* - View all registered users\n";
      helpMessage += "🔹 *password* - View role passwords\n";
    } else {
      helpMessage += "👤 *User Commands*\n\n";
      helpMessage += "🔹 *sales* - View event sales figures\n";
      helpMessage += "🔹 *promoter* - View promoter ticket data\n";
      helpMessage += "🔹 *timezone* - Change your timezone setting\n";
      helpMessage += "🔹 *help* - Show this help menu\n";
      helpMessage += "🔹 *status* - Check your current status\n";
      helpMessage += "🔹 *role* - Request additional roles\n";
      helpMessage += "🔹 *unregister* - Remove your registration\n";
    }
  }

  // Add secondary role information if user has any
  const secondaryRoles = getUserSecondaryRoles(user);
  if (secondaryRoles.length > 0) {
    helpMessage += "\n🎭 *Your Additional Roles:*\n";
    secondaryRoles.forEach(roleKey => {
      const roleInfo = permissions.secondaryRoles[roleKey];
      if (roleInfo) {
        helpMessage += `• ${roleInfo.name}\n`;
      }
    });
  }

  helpMessage += "\nNeed more assistance? Just ask!";
  
  return helpMessage;
}

module.exports = {
  hasCommandPermission,
  hasFeaturePermission,
  getUserSecondaryRoles,
  getFormattedUserRoles,
  generateRoleBasedHelp
};