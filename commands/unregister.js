// commands/unregister.js - Fixed to properly handle template variables
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');

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
          const unregisterTemplates = templates.get('unregister', { username: targetUsername });
          await sendMessage(from, unregisterTemplates.userNotFound);
          return confirmationState;
        }

        // Prevent admin from deleting another admin
        if (targetUser.bot_userrole === 'ADMIN') {
          const unregisterTemplates = templates.get('unregister');
          await sendMessage(from, unregisterTemplates.cannotDeleteAdmin);
          return confirmationState;
        }

        // Start confirmation for deleting another user
        confirmationState[from] = { 
          action: 'unregister', 
          targetUser: targetUser,
          timestamp: Date.now() 
        };
        
        const unregisterTemplates = templates.get('unregister', { username: targetUser.bot_username });
        await sendMessage(from, unregisterTemplates.confirmOther);
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
      
      const unregisterTemplates = templates.get('unregister');
      await sendMessage(from, unregisterTemplates.confirmSelf);
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
          const unregisterTemplates = templates.get('unregister', { username: userToDelete.bot_username });
          await sendMessage(from, unregisterTemplates.successOther);
        } else {
          const unregisterTemplates = templates.get('unregister');
          await sendMessage(from, unregisterTemplates.successSelf);
        }
      }
      
      delete confirmationState[from];
    } else if (response === 'no' || response === 'cancel') {
      const unregisterTemplates = templates.get('unregister');
      await sendMessage(from, unregisterTemplates.canceled);
      delete confirmationState[from];
    } else {
      // Invalid response
      const unregisterTemplates = templates.get('unregister');
      await sendMessage(from, unregisterTemplates.invalidResponse);
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

module.exports = handleUnregister;