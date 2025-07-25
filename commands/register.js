// commands/register.js - Updated with timezone selection
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');

async function handleRegister(from, text, registrationState, supabase) {
  const { ADMIN_PASSWORD, USER_PASSWORD } = process.env;
  
  if (!registrationState[from]) {
    // Start registration process
    registrationState[from] = { step: 1 };
    const registrationTemplates = templates.get('registration');
    await sendMessage(from, registrationTemplates.welcome);
    return registrationState;
  }

  if (registrationState[from].step === 1) {
    // Handle name input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const registrationTemplates = templates.get('registration');
      await sendMessage(from, registrationTemplates.canceled);
      return registrationState;
    }

    registrationState[from].username = text;
    registrationState[from].step = 2;
    const registrationTemplates = templates.get('registration', { name: text });
    await sendMessage(from, registrationTemplates.step2);
    return registrationState;
  }

  if (registrationState[from].step === 2) {
    // Handle password input
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const registrationTemplates = templates.get('registration');
      await sendMessage(from, registrationTemplates.canceled);
      return registrationState;
    }

    const password = text;
    let role = '';

    if (password === ADMIN_PASSWORD) {
      role = 'ADMIN';
    } else if (password === USER_PASSWORD) {
      role = 'USER';
    } else {
      const registrationTemplates = templates.get('registration');
      await sendMessage(from, registrationTemplates.wrongPassword);
      return registrationState;
    }

    registrationState[from].role = role;
    registrationState[from].step = 3;
    const registrationTemplates = templates.get('registration');
    await sendMessage(from, registrationTemplates.step3);
    return registrationState;
  }

  if (registrationState[from].step === 3) {
    // Handle timezone selection
    if (text.toLowerCase() === 'cancel') {
      delete registrationState[from];
      const registrationTemplates = templates.get('registration');
      await sendMessage(from, registrationTemplates.canceled);
      return registrationState;
    }

    const input = text.toLowerCase().trim();
    let timezone = '';
    let timezoneName = '';

    if (input === '1' || input === 'montreal' || input === 'eastern') {
      timezone = 'America/New_York';
      timezoneName = 'Montreal (Eastern)';
    } else if (input === '2' || input === 'la' || input === 'los angeles' || input === 'pacific') {
      timezone = 'America/Los_Angeles';
      timezoneName = 'Los Angeles (Pacific)';
    } else if (input === '3' || input === 'other' || input === 'utc') {
      timezone = 'UTC';
      timezoneName = 'UTC (Other)';
    } else {
      const registrationTemplates = templates.get('registration');
      await sendMessage(from, registrationTemplates.invalidTimezone);
      return registrationState;
    }

    // Save to database using the database script
    try {
      const result = await database.registerUser(
        from, 
        registrationState[from].username, 
        registrationState[from].role,
        timezone
      );
      
      if (result.success) {
        const registrationTemplates = templates.get('registration', {
          name: registrationState[from].username,
          role: registrationState[from].role,
          timezone: timezoneName
        });
        await sendMessage(from, registrationTemplates.success);
      } else {
        const registrationTemplates = templates.get('registration');
        await sendMessage(from, registrationTemplates.failed);
      }
    } catch (error) {
      console.error('Registration error:', error);
      const registrationTemplates = templates.get('registration');
      await sendMessage(from, registrationTemplates.failed);
    }

    delete registrationState[from];
    return registrationState;
  }

  return registrationState;
}

module.exports = handleRegister;