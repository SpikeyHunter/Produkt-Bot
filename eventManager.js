const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

// UPDATED: Use the SUPABASE_KEY to match the Render environment
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory state to track last run times
let lastOrderUpdateTime = null;
let lastEventSyncTime = null;
let lastStatusUpdateTime = null;

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
 * Updates event status from LIVE to PAST for events that have finished
 * An event is considered finished when current date > event_date + 1 day
 */
async function updateExpiredEventStatuses() {
  try {
    console.log('🔄 Checking for LIVE events that should be marked as PAST...');
    
    // Get current date in Montreal timezone
    const currentTime = new Date();
    const montrealNow = new Date(currentTime.toLocaleString("en-US", { timeZone: "America/Montreal" }));
    
    // Get all LIVE events
    const { data: liveEvents, error } = await supabase
      .from('events')
      .select('event_id, event_name, event_date, event_status')
      .eq('event_status', 'LIVE');
    
    if (error) {
      console.error('❌ Error fetching LIVE events:', error);
      return;
    }
    
    if (!liveEvents || liveEvents.length === 0) {
      console.log('✅ No LIVE events found to check');
      return;
    }
    
    console.log(`📋 Found ${liveEvents.length} LIVE events to check`);
    
    const eventsToUpdate = [];
    
    for (const event of liveEvents) {
      // Parse event date and add 1 day
      const eventDate = new Date(event.event_date);
      const eventEndDate = new Date(eventDate);
      eventEndDate.setDate(eventEndDate.getDate() + 1);
      
      // If current Montreal time is past event_date + 1 day, mark as PAST
      if (montrealNow > eventEndDate) {
        eventsToUpdate.push({
          event_id: event.event_id,
          event_name: event.event_name,
          event_date: event.event_date
        });
        console.log(`📅 Event "${event.event_name}" (${event.event_date}) should be marked as PAST`);
      }
    }
    
    if (eventsToUpdate.length === 0) {
      console.log('✅ All LIVE events are still active. No status updates needed.');
      return;
    }
    
    console.log(`🔄 Updating ${eventsToUpdate.length} events from LIVE to PAST...`);
    
    // Update events in batches
    const eventIds = eventsToUpdate.map(event => event.event_id);
    
    // Get current time in Montreal timezone with proper formatting
    const timestampTime = new Date();
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Montreal',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
    
    const montrealTimeString = formatter.format(timestampTime).replace(' ', 'T');
    
    // Determine if we're in EDT (-04:00) or EST (-05:00)
    const isDST = timestampTime.getMonth() > 2 && timestampTime.getMonth() < 11; // Rough DST check
    const offset = isDST ? '-04:00' : '-05:00';
    const montrealTimestamp = montrealTimeString + offset;
    
    const { data, error: updateError } = await supabase
      .from('events')
      .update({ 
        event_status: 'PAST',
        event_updated: montrealTimestamp
      })
      .in('event_id', eventIds)
      .select('event_id, event_name, event_status');
    
    if (updateError) {
      console.error('❌ Error updating event statuses:', updateError);
      return;
    }
    
    console.log(`✅ Successfully updated ${data.length} events to PAST status:`);
    data.forEach(event => {
      console.log(`   📅 ${event.event_name} (ID: ${event.event_id}) → ${event.event_status}`);
    });
    
  } catch (error) {
    console.error('❌ Error in updateExpiredEventStatuses:', error);
  }
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

    // EVENT STATUS UPDATE: Check for expired LIVE events every 30 minutes
    const thirtyMinutes = 30 * 60 * 1000;
    if (!lastStatusUpdateTime || (now - lastStatusUpdateTime > thirtyMinutes)) {
      console.log('🔄 Running status update check for expired LIVE events...');
      updateExpiredEventStatuses().catch(err => 
        console.error("Background status update failed:", err)
      );
      lastStatusUpdateTime = now;
    } else {
      const minutesUntilNextStatusUpdate = Math.ceil((thirtyMinutes - (now - lastStatusUpdateTime)) / (60 * 1000));
      console.log(`✅ Status update recently checked. Next check in ~${minutesUntilNextStatusUpdate} minutes.`);
    }

  } catch (err) {
    console.error('❌ Fatal error in manageEventSync:', err);
  }
}

module.exports = { manageEventSync, updateExpiredEventStatuses };