// commands/register.js - Registration command handler

const { sendMessage } = require('../utils');

// Messages for registration
const MESSAGES = {
  welcome: `🎉 *Welcome to Produkt BOT!* 

I'm here to help you get started. Let's begin your registration process.

📝 *Step 1 of 2*
What name would you like me to call you?`,

  step2: (name) => `✅ Nice to meet you, *${name}*! 

📝 *Step 2 of 2*
Please enter your registration password to complete the setup.`,

  success: (name, role) => `🎉 *Registration Complete!* 

Welcome aboard, *${name}*! 
You're now registered as a *${role}*.

Type *help* to explore what you can do!`,

  wrongPassword: `❌ *Incorrect Password* 

The password you entered is not valid. Please try again, or type *cancel* to stop the registration process.`,

  failed: `⚠️ *Registration Failed* 

Sorry, I couldn't save your registration due to a technical issue. Please try again later or contact support.`,

  canceled: `❌ *Registration Canceled* 

No worries! You can start the registration process anytime by typing *register*.`
};

/**
 * Handles the registration flow for new users
 * @param {string} from - User's phone number
 * @param {string} text - User's message text
 * @param {object} registrationState - Current registration state
 * @param {object} supabase - Supabase client
 * @returns {object} Updated registration state
 */
async function handleRegister(from, text, registrationState, supabase) {
  const { ADMIN_PASSWORD, USER_PASSWORD } = process.env;
  
  if (!registrationState[from]) {
    // Start registration process
    registrationState[from] = { step: 1 };
    await sendMessage(from, MESSAGES.welcome);
    return registrationState;
  }

  if (registrationState[from].step === 1) {
    // Handle name input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      await sendMessage(from, MESSAGES.canceled);
      return registrationState;
    }

    registrationState[from].username = text;
    registrationState[from].step = 2;
    await sendMessage(from, MESSAGES.step2(text));
    return registrationState;
  }

  if (registrationState[from].step === 2) {
    // Handle password input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      await sendMessage(from, MESSAGES.canceled);
      return registrationState;
    }

    const password = text;
    let role = '';

    if (password === ADMIN_PASSWORD) {
      role = 'ADMIN';
    } else if (password === USER_PASSWORD) {
      role = 'USER';
    } else {
      await sendMessage(from, MESSAGES.wrongPassword);
      return registrationState;
    }

    // Save to database
    try {
      const { error: insertError } = await supabase.from('bot_users').upsert({
        bot_userphone: from,
        bot_username: registrationState[from].username,
        bot_userstatus: 'OPTIN',
        bot_userrole: role,
      }, { onConflict: 'bot_userphone' });
      
      if (insertError) {
        console.error('Supabase error inserting/updating user:', insertError);
        await sendMessage(from, MESSAGES.failed);
      } else {
        await sendMessage(from, MESSAGES.success(registrationState[from].username, role));
      }
    } catch (error) {
      console.error('Registration error:', error);
      await sendMessage(from, MESSAGES.failed);
    }

    delete registrationState[from];
    return registrationState;
  }

  return registrationState;
}

module.exports = handleRegister;