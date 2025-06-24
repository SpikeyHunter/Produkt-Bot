// commands/register.js - Updated to use templates and database script
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');

async function handleRegister(from, text, registrationState, supabase) {
  const { ADMIN_PASSWORD, USER_PASSWORD } = process.env;
  
  if (!registrationState[from]) {
    // Start registration process
    registrationState[from] = { step: 1 };
    const welcomeMessage = templates.get('registration').welcome;
    await sendMessage(from, welcomeMessage);
    return registrationState;
  }

  if (registrationState[from].step === 1) {
    // Handle name input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const cancelMessage = templates.get('registration').canceled;
      await sendMessage(from, cancelMessage);
      return registrationState;
    }

    registrationState[from].username = text;
    registrationState[from].step = 2;
    const step2Message = templates.get('registration', { name: text }).step2;
    await sendMessage(from, step2Message);
    return registrationState;
  }

  if (registrationState[from].step === 2) {
    // Handle password input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const cancelMessage = templates.get('registration').canceled;
      await sendMessage(from, cancelMessage);
      return registrationState;
    }

    const password = text;
    let role = '';

    if (password === ADMIN_PASSWORD) {
      role = 'ADMIN';
    } else if (password === USER_PASSWORD) {
      role = 'USER';
    } else {
      const wrongPasswordMessage = templates.get('registration').wrongPassword;
      await sendMessage(from, wrongPasswordMessage);
      return registrationState;
    }

    // Save to database using the database script
    try {
      const result = await database.registerUser(
        from, 
        registrationState[from].username, 
        role
      );
      
      if (result.success) {
        const successMessage = templates.get('registration', {
          name: registrationState[from].username,
          role: role
        }).success;
        await sendMessage(from, successMessage);
      } else {
        const failedMessage = templates.get('registration').failed;
        await sendMessage(from, failedMessage);
      }
    } catch (error) {
      console.error('Registration error:', error);
      const failedMessage = templates.get('registration').failed;
      await sendMessage(from, failedMessage);
    }

    delete registrationState[from];
    return registrationState;
  }

  return registrationState;
}

module.exports = handleRegister;