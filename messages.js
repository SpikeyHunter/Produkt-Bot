// messages.js - Centralized message templates for the WhatsApp bot

const messages = {
  // Welcome and Registration Messages
  welcome: {
    newUser: `🎉 *Welcome to Produkt BOT!* 

I'm here to help you get started. Let's begin your registration process.

📝 *Step 1 of 2*
What name would you like me to call you?`,

    existingUser: (username, role) => `👋 Hello ${username}! 

You're already registered as a *${role}*.

Type *help* to see what I can do for you!`,

    registrationStep2: (name) => `✅ Nice to meet you, *${name}*! 

📝 *Step 2 of 2*
Please enter your registration password to complete the setup.`,

    registrationSuccess: (name, role) => `🎉 *Registration Complete!* 

Welcome aboard, *${name}*! 
You're now registered as a *${role}*.

Type *help* to explore what you can do!`,

    registrationError: `❌ *Incorrect Password* 

The password you entered is not valid. Please try again, or type *cancel* to stop the registration process.`,

    registrationFailed: `⚠️ *Registration Failed* 

Sorry, I couldn't save your registration due to a technical issue. Please try again later or contact support.`,

    registrationCanceled: `❌ *Registration Canceled* 

No worries! You can start the registration process anytime by typing *register*.`
  },

  // Help and Command Messages
  help: {
    general: `📋 *Available Commands*

🔹 *help* - Show this help menu
🔹 *register* - Start registration process
🔹 *unregister* - Remove your registration
🔹 *status* - Check your current status

Need more assistance? Just ask!`,

    admin: `👨‍💼 *Admin Commands*

🔹 *help* - Show this help menu
🔹 *register* - Start registration process
🔹 *unregister* - Remove your registration
🔹 *status* - Check your current status
🔹 *users* - View user statistics
🔹 *broadcast* - Send message to all users

Need more assistance? Just ask!`,

    user: `👤 *User Commands*

🔹 *help* - Show this help menu
🔹 *register* - Start registration process
🔹 *unregister* - Remove your registration
🔹 *status* - Check your current status

Need more assistance? Just ask!`
  },

  // Status and Information Messages
  status: {
    registered: (username, role, phone) => `📊 *Your Status*

👤 *Name:* ${username}
🏷️ *Role:* ${role}
📱 *Phone:* ${phone}
✅ *Status:* Active

You're all set up and ready to go!`,

    unregistered: `📊 *Your Status*

❌ You are not currently registered.

Type *register* to get started!`
  },

  // System Messages
  system: {
    unregisterSuccess: `✅ *Unregistered Successfully* 

You have been removed from the system. Your data has been marked as inactive.

Send *register* anytime to rejoin us!`,

    databaseError: `⚠️ *Technical Issue* 

I'm experiencing some technical difficulties right now. Please try again in a few moments.

If the problem persists, please contact support.`,

    unknownCommand: (command) => `❓ *Unknown Command* 

I don't recognize the command "*${command}*".

Type *help* to see available commands.`,

    generalError: `😅 *Oops!* 

Something went wrong on my end. Please try again, and if the issue continues, let me know!`
  },

  // Interactive Messages
  interactive: {
    processingRegistration: `⏳ *Processing...* 

Setting up your account, please wait a moment.`,

    confirmUnregister: `⚠️ *Confirm Unregistration* 

Are you sure you want to unregister? This will remove your access to the system.

Reply *yes* to confirm or *no* to cancel.`
  }
};

module.exports = messages;