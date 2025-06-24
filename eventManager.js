const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

// This should be the same Supabase client from your index.js
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory state to track last run time for event-orders.js
let lastOrderUpdateTime = null;

/**
 * Executes a shell command and logs its output.
 * @param {string} command - The command to execute.
 * @returns {Promise<void>}
 */
function runScript(command) {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Running script: ${command}`);
    const process = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error executing ${command}:`, error);
        return reject(error);
      }
      if (stderr) {
        console.error(`stderr from ${command}:`, stderr);
      }
      console.log(`stdout from ${command}:`, stdout);
      resolve();
    });
  });
}

/**
 * Checks the last event sync time and runs scripts if needed.
 * This is the main function to be called on user interaction.
 */
async function manageEventSync() {
  try {
    // 1. Check event_updated from the events table
    const { data, error } = await supabase
      .from('events')
      .select('event_updated')
      .order('event_updated', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') { // Ignore 'No rows found' error
          console.error('❌ Supabase error fetching last event_updated:', error);
      }
      // Decide if you want to proceed or stop if this fails
      // For now, we'll proceed and assume a sync is needed.
    }

    const lastSyncTime = data ? new Date(data.event_updated) : null;
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    // 2. Run event-sync.js if it's been more than 12 hours
    if (!lastSyncTime || lastSyncTime < twelveHoursAgo) {
      console.log('⏰ Last sync was more than 12 hours ago or never happened. Running event-sync.js...');
      await runScript('node event-sync.js all');
    } else {
      console.log('✅ Event sync is up-to-date (less than 12 hours).');
    }

    // 3. Run event-orders.js update (with 15-minute interval)
    const fifteenMinutes = 15 * 60 * 1000;
    if (!lastOrderUpdateTime || (Date.now() - lastOrderUpdateTime > fifteenMinutes)) {
        console.log('🔄 Running event-orders.js update...');
        await runScript('node event-orders.js update');
        lastOrderUpdateTime = Date.now();
    } else {
        console.log('✅ Event orders recently updated. Skipping.');
    }

  } catch (err) {
    console.error('❌ Fatal error in manageEventSync:', err);
  }
}

module.exports = { manageEventSync };