// handlers.js - Message handling functions for the WhatsApp bot

const messages = require('./messages');
const { sendMessage } = require('./utils');

/**
 * Handles the registration flow for new users
 * @param {string} from - User's phone number
 * @param {string} text - User's message text
 * @param {object} registrationState - Current registration state
 * @param {object} supabase - Supabase client
 * @returns {object} Updated registration state
 */
async function handleRegistration(from, text, registrationState, supabase) {
  const { ADMIN_PASSWORD, USER_PASSWORD } = process.env;
  
  if (!registrationState[from]) {
    // Start registration process
    registrationState[from] = { step: 1 };
    await sendMessage(from, messages.welcome.newUser);
    return registrationState;
  }

  if (registrationState[from].step === 1) {
    // Handle name input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      await sendMessage(from, messages.welcome.registrationCanceled);
      return registrationState;
    }

    registrationState[from].username = text;
    registrationState[from].step = 2;
    await sendMessage(from, messages.welcome.registrationStep2(text));
    return registrationState;
  }

  if (registrationState[from].step === 2) {
    // Handle password input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      await sendMessage(from, messages.welcome.registrationCanceled);
      return registrationState;
    }

    const password = text;
    let role = '';

    if (password === ADMIN_PASSWORD) {
      role = 'ADMIN';
    } else if (password === USER_PASSWORD) {
      role = 'USER';
    } else {
      await sendMessage(from, messages.welcome.registrationError);
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
        await sendMessage(from, messages.welcome.registrationFailed);
      } else {
        await sendMessage(from, messages.welcome.registrationSuccess(registrationState[from].username, role));
      }
    } catch (error) {
      console.error('Registration error:', error);
      await sendMessage(from, messages.welcome.registrationFailed);
    }

    delete registrationState[from];
    return registrationState;
  }

  return registrationState;
}

/**
 * Handles help command based on user role
 * @param {string} from - User's phone number
 * @param {object} user - User data from database
 */
async function handleHelp(from, user = null) {
  if (!user) {
    await sendMessage(from, messages.help.general);
    return;
  }

  switch (user.bot_userrole) {
    case 'ADMIN':
      await sendMessage(from, messages.help.admin);
      break;
    case 'USER':
      await sendMessage(from, messages.help.user);
      break;
    default:
      await sendMessage(from, messages.help.general);
  }
}

/**
 * Handles status command
 * @param {string} from - User's phone number
 * @param {object} user - User data from database
 */
async function handleStatus(from, user = null) {
  if (!user) {
    await sendMessage(from, messages.status.unregistered);
    return;
  }

  const statusMessage = messages.status.registered(
    user.bot_username,
    user.bot_userrole,
    user.bot_userphone
  );
  await sendMessage(from, statusMessage);
}

/**
 * Handles unregister command
 * @param {string} from - User's phone number
 * @param {object} supabase - Supabase client
 */
async function handleUnregister(from, supabase) {
  try {
    const { error } = await supabase
      .from('bot_users')
      .update({ bot_userstatus: 'OPTOUT' })
      .eq('bot_userphone', from);

    if (error) {
      console.error('Unregister error:', error);
      await sendMessage(from, messages.system.generalError);
    } else {
      await sendMessage(from, messages.system.unregisterSuccess);
    }
  } catch (error) {
    console.error('Unregister error:', error);
    await sendMessage(from, messages.system.generalError);
  }
}

/**
 * Handles unknown commands
 * @param {string} from - User's phone number
 * @param {string} command - The unknown command
 */
async function handleUnknownCommand(from, command) {
  await sendMessage(from, messages.system.unknownCommand(command));
}

/**
 * Handles existing user messages
 * @param {string} from - User's phone number
 * @param {object} user - User data from database
 */
async function handleExistingUser(from, user) {
  await sendMessage(from, messages.welcome.existingUser(user.bot_username, user.bot_userrole));
}

module.exports = {
  handleRegistration,
  handleHelp,
  handleStatus,
  handleUnregister,
  handleUnknownCommand,
  handleExistingUser
};