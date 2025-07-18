const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

// UPDATED: Use the SUPABASE_KEY to match the Render environment
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
    
    const options = {
        env: process.env
    };

    const childProcess = exec(command, options, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error executing ${command}:`, error);
        return reject(error);
      }
      if (stderr) {
        console.warn(`stderr from ${command}:`, stderr);
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
    // Check if we have any events that have NEVER been synced (NULL)
    const { data: neverSynced } = await supabase
      .from('events')
      .select('event_id')
      .is('event_order_updated', null)
      .limit(1);

    // If there are events that were never synced, force run event-orders
    if (neverSynced && neverSynced.length > 0) {
      console.log('🔄 Found events that were never synced. Running event-orders.js...');
      runScript('node event-orders.js update').catch(err => console.error("Background event-orders.js failed:", err));
      lastOrderUpdateTime = Date.now();
      return; // Exit early since we're syncing
    }

    // Rest of your existing logic...
    const fifteenMinutes = 15 * 60 * 1000;
    if (!lastOrderUpdateTime || (Date.now() - lastOrderUpdateTime > fifteenMinutes)) {
        console.log('🔄 Running event-orders.js update...');
        runScript('node event-orders.js update').catch(err => console.error("Background event-orders.js failed:", err));
        lastOrderUpdateTime = Date.now();
    } else {
        console.log('✅ Event orders recently updated. Skipping.');
    }
  } catch (err) {
    console.error('❌ Fatal error in manageEventSync:', err);
  }
}

module.exports = { manageEventSync };
