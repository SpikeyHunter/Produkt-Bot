// commands/timezone.js - Handle timezone changes
const { sendMessage } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');

async function handleTimezone(from, text, timezoneState, supabase, user) {
  // Only registered users can change timezone
  if (!user) {
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.welcomeUnregistered);
    return timezoneState;
  }

  if (!timezoneState[from]) {
    // Start timezone change process
    timezoneState[from] = { step: 1 };
    const currentTz = database.getTimezoneName(user.bot_user_timezone);
    const timezoneTemplates = templates.get('timezone', { currentTimezone: currentTz });
    await sendMessage(from, timezoneTemplates.prompt);
    return timezoneState;
  }

  if (timezoneState[from].step === 1) {
    // Handle timezone selection
    if (text.toLowerCase() === 'cancel') {
      delete timezoneState[from];
      const timezoneTemplates = templates.get('timezone');
      await sendMessage(from, timezoneTemplates.canceled);
      return timezoneState;
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
      const timezoneTemplates = templates.get('timezone');
      await sendMessage(from, timezoneTemplates.invalid);
      return timezoneState;
    }

    // Check if it's the same timezone
    if (timezone === user.bot_user_timezone) {
      const timezoneTemplates = templates.get('timezone', { timezone: timezoneName });
      await sendMessage(from, timezoneTemplates.unchanged);
      delete timezoneState[from];
      return timezoneState;
    }

    // Update timezone in database
    try {
      const result = await database.updateUserTimezone(from, timezone);
      
      if (result.success) {
        const timezoneTemplates = templates.get('timezone', { 
          timezone: timezoneName,
          oldTimezone: database.getTimezoneName(user.bot_user_timezone)
        });
        await sendMessage(from, timezoneTemplates.success);
      } else {
        const timezoneTemplates = templates.get('timezone');
        await sendMessage(from, timezoneTemplates.failed);
      }
    } catch (error) {
      console.error('Timezone update error:', error);
      const timezoneTemplates = templates.get('timezone');
      await sendMessage(from, timezoneTemplates.failed);
    }

    delete timezoneState[from];
    return timezoneState;
  }

  return timezoneState;
}

module.exports = handleTimezone;