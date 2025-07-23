const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

// UPDATED: Use the SUPABASE_KEY to match the Render environment
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory state to track last run times
let lastOrderUpdateTime = null;
let lastEventSyncTime = null;

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
 * Checks the last sync times and runs scripts if needed.
 * This manages both event data sync and order data sync.
 * @param {boolean} forceSalesSync - Force run event-orders.js regardless of cooldown
 */
async function manageEventSync(forceSalesSync = false) {
  try {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // SALES/ORDERS SYNC: Run if forced (sales command) or if events need syncing
    if (forceSalesSync) {
      console.log('🔄 Force running event-orders.js (sales command triggered)...');
      runScript('node event-orders.js update').catch(err => 
        console.error("Background event-orders.js failed:", err)
      );
      lastOrderUpdateTime = now;
    } else {
      // NEW LOGIC: Check if any events need order updates using proper date logic
      const { data: allEvents } = await supabase
        .from('events')
        .select('event_id, event_date, event_order_updated');

      let needsOrderSync = false;

      if (allEvents) {
        for (const event of allEvents) {
          // If never synced, definitely needs sync
          if (!event.event_order_updated) {
            needsOrderSync = true;
            console.log(`📋 Event ${event.event_id} never synced - needs order sync`);
            break;
          } else {
            // Check if last updated is before event_date + 1 day (same logic as event-orders.js)
            const eventDate = new Date(event.event_date);
            const dayAfter = new Date(eventDate);
            dayAfter.setDate(dayAfter.getDate() + 1);
            const lastUpdated = new Date(event.event_order_updated);
            
            if (lastUpdated < dayAfter) {
              needsOrderSync = true;
              console.log(`📋 Event ${event.event_id} last updated ${lastUpdated.toISOString()}, needs sync (event date: ${event.event_date})`);
              break;
            }
          }
        }
      }

      if (needsOrderSync) {
        console.log('🔄 Found events that need order sync. Running event-orders.js...');
        runScript('node event-orders.js update').catch(err => 
          console.error("Background event-orders.js failed:", err)
        );
        lastOrderUpdateTime = now;
      } else {
        console.log('✅ Event orders recently updated. Skipping.');
      }
    }

    // EVENT SYNC: Regular hourly sync for event statuses (LIVE/PAST)
    const { data: neverSyncedEvents } = await supabase
      .from('events')
      .select('event_id')
      .is('event_updated', null)
      .limit(1);

    // If there are events that were never synced, force run event-sync
    if (neverSyncedEvents && neverSyncedEvents.length > 0) {
      console.log('🔄 Found events that were never synced. Running event-sync.js...');
      runScript('node event-sync.js all').catch(err => 
        console.error("Background event-sync.js failed:", err)
      );
      lastEventSyncTime = now;
    }
    // Otherwise check if it's time for regular event sync (every hour)
    else if (!lastEventSyncTime || (now - lastEventSyncTime > oneHour)) {
      console.log('🔄 Running event-sync.js all (scheduled)...');
      runScript('node event-sync.js all').catch(err => 
        console.error("Background event-sync.js failed:", err)
      );
      lastEventSyncTime = now;
    } else {
      const minutesUntilNextSync = Math.ceil((oneHour - (now - lastEventSyncTime)) / (60 * 1000));
      console.log(`✅ Event sync recently updated. Next sync in ~${minutesUntilNextSync} minutes.`);
    }

  } catch (err) {
    console.error('❌ Fatal error in manageEventSync:', err);
  }
}

module.exports = { manageEventSync };