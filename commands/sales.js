// commands/sales.js

// ADDED: Import the 'exec' function to run shell commands
const { exec } = require('child_process');
const { sendMessage, sendMessageInstant } = require('../utils');
const { format } = require('date-fns');
const { toZonedTime } = require('date-fns-tz');

// Permission checking function
function hasFeaturePermission(user, feature) {
  if (!user) return false;
  if (user.bot_userrole === 'ADMIN') return true;
  if (feature === 'view_gross_net_sales') {
    if (!user.bot_secondary_roles) return false;
    const userSecondaryRoles = user.bot_secondary_roles.split(',');
    return userSecondaryRoles.includes('MANAGERSALES');
  }
  return false;
}

// Helper function to safely parse date strings
function parseEventDate(dateString) {
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
    return new Date(dateString);
}

// ADDED: Function to run your sync scripts in the background
function runBackgroundSync(from) {
    // Using 'check-changes' for sync-events is faster than a full sync.
    const scripts = ['sync-events.js check-changes', 'sync-sales.js'];
    
    console.log(`🚀 Triggering background sync for user ${from}...`);
    scripts.forEach(script => {
        exec(`node ${script}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`[${script}] exec error: ${error}`);
                return;
            }
            // Optional: log output for debugging
            // if (stderr) console.warn(`[${script}] stderr: ${stderr}`);
            // console.log(`[${script}] stdout: ${stdout}`);
            console.log(`✅ [${script}] background sync completed.`);
        });
    });
}


async function getAllUpcomingEvents(supabase, user) {
    try {
        const userTimezone = user?.bot_user_timezone || 'America/New_York';
        const today = new Date();
        const todayInUserTZ = toZonedTime(today, userTimezone);
        const todayDateString = format(todayInUserTZ, 'yyyy-MM-dd');

        const { data: events, error } = await supabase
            .from('events')
            .select('event_id, event_name, event_date')
            .gte('event_date', todayDateString)
            .order('event_date', { ascending: true });

        if (error) {
            console.error("Error fetching upcoming events:", error);
            return null;
        }

        if (!events) return [];
        const excludeWords = /Piknic|Test|Pass|Event|Template|Réservations/i;
        return events.filter(event => !excludeWords.test(event.event_name));

    } catch (e) {
        console.error("Exception in getAllUpcomingEvents:", e);
        return null;
    }
}

async function displayEventList(from, events, showAll = false) {
    if (!events || events.length === 0) {
        await sendMessage(from, "📅 *No Upcoming Events*\n\nThere are no upcoming events scheduled at this time that match the criteria.");
        return;
    }

    const eventsToShow = showAll ? events : events.slice(0, 5);
    let message = `🎟️ *Upcoming Events* (showing ${eventsToShow.length} of ${events.length})\n\nPlease select an event by typing its ID, Name, or Date:\n\n`;
    
    eventsToShow.forEach(event => {
        const eventDate = parseEventDate(event.event_date);
        const formattedDate = format(eventDate, 'MMMM d');
        const eventName = event.event_name.split(',')[0];
        message += `${event.event_id} - ${formattedDate} - ${eventName}\n`;
    });
    
    if (!showAll && events.length > 5) {
        message += '\nType *all* to see all upcoming events or *cancel* to exit.';
    } else {
        message += '\nType *cancel* to exit.';
    }

    await sendMessageInstant(from, message);
}

async function listUpcomingEvents(from, supabase, user, showAll = false) {
    try {
        const events = await getAllUpcomingEvents(supabase, user);

        if (events === null) {
            await sendMessage(from, "❌ *Database Error*\n\nI couldn't fetch the event list from our database. Please try again in a moment.");
            return null;
        }
        if (events.length === 0) {
            await sendMessage(from, "📅 *No Upcoming Events*\n\nThere are no upcoming events scheduled at this time.");
            return [];
        }

        await displayEventList(from, events, showAll);
        return events;
    } catch (e) {
        console.error("Exception in listUpcomingEvents:", e);
        await sendMessage(from, "⚠️ *Connection Error*\n\nI'm having trouble connecting to our systems right now. Please try again in a few moments.");
        return null;
    }
}

function formatCurrency(amount) {
    if (!amount || amount === 0) return null;
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

async function showSalesReport(from, supabase, event, user) {
    await sendMessageInstant(from, "📊 *Loading sales data...*\n\nRetrieving sales information for this event.");
    
    const { data: salesData, error } = await supabase
        .from('events_sales')
        .select('*')
        .eq('event_id', event.event_id)
        .single();

    if (error || !salesData) {
        console.error("Error fetching sales data:", error);
        await sendMessage(from, "⚠️ *No Sales Data*\n\nNo sales data is available for this event yet, or there was an error retrieving it.");
        return;
    }

    const canViewFinancials = hasFeaturePermission(user, 'view_gross_net_sales');
    const eventDate = parseEventDate(event.event_date);
    const formattedDate = format(eventDate, 'MMMM d, yyyy');
    const eventName = event.event_name.split(',')[0];

    let report = `📊 *SALES REPORT*\n\n*${event.event_id} - ${formattedDate} - ${eventName}*\n\n`;
    const totalPaidTickets = (salesData.sales_total_ga || 0) + (salesData.sales_total_vip || 0) + (salesData.sales_total_tables || 0);
    const totalComps = (salesData.sales_total_comp_ga || 0) + (salesData.sales_total_comp_vip || 0);
    const totalFree = (salesData.sales_total_free_ga || 0) + (salesData.sales_total_free_vip || 0);
    let hasSalesData = false;

    if (totalPaidTickets > 0 || salesData.sales_total_coatcheck > 0 || salesData.sales_gross > 0) {
        hasSalesData = true;
        report += `*Total Paid:* ${totalPaidTickets + (salesData.sales_total_coatcheck || 0)}\n`;
        if (salesData.sales_total_ga > 0) report += `   - GA Tickets: ${salesData.sales_total_ga}\n`;
        if (salesData.sales_total_vip > 0) report += `   - VIP Tickets: ${salesData.sales_total_vip}\n`;
        if (salesData.sales_total_tables > 0) report += `   - Tables: ${salesData.sales_total_tables}\n`;
        if (salesData.sales_total_coatcheck > 0) report += `   - Coatcheck: ${salesData.sales_total_coatcheck}\n`;
        
        if (canViewFinancials) {
            if (salesData.sales_gross > 0) report += `\n   - Gross: ${formatCurrency(salesData.sales_gross)}\n`;
            if (salesData.sales_net > 0) report += `   - Net: ${formatCurrency(salesData.sales_net)}\n`;
        } else if (salesData.sales_gross > 0 || salesData.sales_net > 0) {
            report += `\n   - Financial data: 🔒 *Manager Sales role required*\n`;
        }
    }

    if (totalComps > 0) {
        hasSalesData = true;
        report += `\n*Total Comps:* ${totalComps}\n`;
        if (salesData.sales_total_comp_ga > 0) report += `   - Comp GA: ${salesData.sales_total_comp_ga}\n`;
        if (salesData.sales_total_comp_vip > 0) report += `   - Comp VIP: ${salesData.sales_total_comp_vip}\n`;
    }

    if (totalFree > 0) {
        hasSalesData = true;
        report += `\n*Total Free Tickets:* ${totalFree}\n`;
        if (salesData.sales_total_free_ga > 0) report += `   - Free GA: ${salesData.sales_total_free_ga}\n`;
        if (salesData.sales_total_free_vip > 0) report += `   - Free VIP: ${salesData.sales_total_free_vip}\n`;
    }

    if (!hasSalesData) {
        await sendMessage(from, "📊 *No Sales Data*\n\nThis event doesn't have any sales, comps, or free tickets recorded yet.");
        return;
    }

    await sendMessageInstant(from, report);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sendMessage(from, "🔄 *Would you like to check another event?*\n\nType *yes* to see more events or *no* to exit.", 800);
}

async function handleSales(from, text, salesState, supabase, user) {
    if (!salesState[from]) {
        // MODIFIED: Run sync scripts and notify the user at the start of the flow.
        runBackgroundSync(from);
        await sendMessageInstant(from, "🔄 *Refreshing the latest data...*\n\nPlease wait a moment while I fetch the event list.");
        
        const events = await listUpcomingEvents(from, supabase, user);
        if (events && events.length > 0) {
            salesState[from] = { step: 'selecting_event', events };
        } else {
            delete salesState[from];
        }
        return salesState;
    }

    const state = salesState[from];
    const input = text.trim().toLowerCase();

    if (state.step === 'selecting_event') {
        if (input === 'cancel') {
            delete salesState[from];
            await sendMessageInstant(from, "✅ *Sales lookup canceled.*");
            return salesState;
        }
        if (input === 'all') {
            await displayEventList(from, state.events, true);
            return salesState;
        }
        const selectedEvent = state.events.find(
            e => e.event_id.toString() === input ||
            e.event_name.toLowerCase().split(',')[0].includes(input) ||
            format(parseEventDate(e.event_date), 'MMMM d').toLowerCase() === input
        );

        if (selectedEvent) {
            await showSalesReport(from, supabase, selectedEvent, user);
            salesState[from] = { step: 'asking_continue', events: state.events, lastEvent: selectedEvent };
        } else {
            await sendMessageInstant(from, "❌ *Invalid Selection*\n\nPlease type a valid Event ID, Name, or Date from the list.\n\nOr type *cancel* to exit.");
        }
    } else if (state.step === 'asking_continue') {
        if (input === 'yes' || input === 'y') {
            await displayEventList(from, state.events, true);
            salesState[from] = { step: 'selecting_event', events: state.events };
        } else if (input === 'no' || input === 'n') {
            delete salesState[from];
            await sendMessage(from, "✅ *Thanks for using the sales module!*\n\nType *help* to see other available commands.", 400);
        } else {
            await sendMessage(from, "❓ *Please respond with yes or no*\n\nType *yes* to check another event or *no* to exit.", 600);
        }
    }

    return salesState;
}

module.exports = handleSales;