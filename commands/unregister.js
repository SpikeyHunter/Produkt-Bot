// commands/unregister.js - Unregister command handler

const { sendMessage } = require('../utils');

// Unregister messages
const MESSAGES = {
  confirmSelf: `⚠️ *Confirm Account Deletion* 

Are you sure you want to permanently delete your account? This action cannot be undone and will remove all your data.

Reply *yes* to confirm or *no* to cancel.`,

  confirmOther: (targetUsername) => `⚠️ *Confirm User Deletion* 

Are you sure you want to permanently delete ${targetUsername}'s account? This action cannot be undone.

Reply *yes* to confirm or *no* to cancel.`,

  successSelf: `✅ *Account Deleted Successfully* 

Your account has been completely removed from our system.

Send *register* anytime to create a new account!`,

  successOther: (targetUsername) => `✅ *User Deleted Successfully* 

${targetUsername}'s account has been completely removed from the system.`,

  canceled: `❌ *Deletion Canceled* 

No worries! The account remains active.

Type *help* to see available commands.`,

  invalidResponse: `❓ *Please Confirm* 

Please reply with *yes* to confirm or *no* to cancel.`,

  userNotFound: (searchName) => `❌ *User Not Found*

No user found with the name "${searchName}".

Use *list users* to see all registered users.`,

  accessDenied: `❌ *Access Denied*

Only admins can unregister other users.

Type *help* to see your available commands.`,

  cannotDeleteSelf: `❌ *Cannot Delete Admin*

You cannot delete another admin account for security reasons.

Use *unregister* to delete your own account.`
};

/**
 * Handles unregister command and confirmation
 * @param {string} from - User's phone number
 * @param {string} text - User's message text
 * @param {object} confirmationState - Confirmation state object
 * @param {object} supabase - Supabase client
 * @param {object} user - Current user data
 * @param {string} targetUsername - Optional target username for admin deletion
 * @returns {object} Updated confirmation state
 */
async function handleUnregister(from, text, confirmationState, supabase, user, targetUsername = '') {
  try {
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
          await sendMessage(from, "⚠️ Technical issue. Please try again later.");
          return confirmationState;
        }

        if (!targetUser) {
          await sendMessage(from, MESSAGES.userNotFound(targetUsername));
          return confirmationState;
        }

        // Prevent admin from deleting another admin
        if (targetUser.bot_userrole === 'ADMIN') {
          await sendMessage(from, MESSAGES.cannotDeleteSelf);
          return confirmationState;
        }

        // Start confirmation for deleting another user
        confirmationState[from] = { 
          action: 'unregister', 
          targetUser: targetUser,
          timestamp: Date.now() 
        };
        await sendMessage(from, MESSAGES.confirmOther(targetUser.bot_username));
        return confirmationState;
      }
      
      // Regular user or admin deleting themselves
      if (targetUsername && user.bot_userrole !== 'ADMIN') {
        await sendMessage(from, MESSAGES.accessDenied);
        return confirmationState;
      }

      // Start confirmation for self-deletion
      confirmationState[from] = { 
        action: 'unregister', 
        targetUser: null, // null means self-deletion
        timestamp: Date.now() 
      };
      await sendMessage(from, MESSAGES.confirmSelf);
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
        await sendMessage(from, "😅 Something went wrong. Please try again!");
      } else {
        if (isAdminDeletingOther) {
          await sendMessage(from, MESSAGES.successOther(userToDelete.bot_username));
        } else {
          await sendMessage(from, MESSAGES.successSelf);
        }
      }
      
      delete confirmationState[from];
    } else if (response === 'no' || response === 'cancel') {
      await sendMessage(from, MESSAGES.canceled);
      delete confirmationState[from];
    } else {
      // Invalid response
      await sendMessage(from, MESSAGES.invalidResponse);
    }

    return confirmationState;
  } catch (error) {
    console.error('Unregister error:', error);
    await sendMessage(from, "😅 Something went wrong. Please try again!");
    delete confirmationState[from];
    return confirmationState;
  }
}

module.exports = handleUnregister;