// commands/sales.js - Updated with permission checking for gross/net sales
const { sendMessage, sendMessageInstant } = require('../utils');
const { format } = require('date-fns');
const { fromZonedTime, toZonedTime } = require('date-fns-tz');
const templates = require('../templates/templateLoader');

// Permission checking function (inline since we can't import from utils/permissionUtils yet)
function hasFeaturePermission(user, feature) {
  if (!user) return false;
  
  // Admin override - admins get all permissions
  if (user.bot_userrole === 'ADMIN') {
    return true;
  }
  
  // For view_gross_net_sales, check if user has MANAGERSALES role
  if (feature === 'view_gross_net_sales') {
    if (!user.bot_secondary_roles) return false;
    const userSecondaryRoles = user.bot_secondary_roles.split(',');
    return userSecondaryRoles.includes('MANAGERSALES');
  }
  
  return false;
}

// Helper function to safely parse date strings and avoid timezone issues
function parseEventDate(dateString) {
    // If the date string is in YYYY-MM-DD format, treat it as a local date
    // to avoid timezone conversion issues
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(year, month - 1, day); // month is 0-indexed
    }
    // Otherwise, parse normally
    return new Date(dateString);
}

async function getAllUpcomingEvents(supabase, user) {
    try {
        // Use user's timezone or default to Eastern
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

        return events || [];
    } catch (e) {
        console.error("Exception in getAllUpcomingEvents:", e);
        return null;
    }
}

async function displayEventList(from, events, showAll = false) {
    if (!events || events.length === 0) {
        await sendMessage(from, "📅 *No Upcoming Events*\n\nThere are no upcoming events scheduled at this time.");
        return;
    }

    // Determine how many events to display
    const eventsToShow = showAll ? events : events.slice(0, 5);
    
    // Build message
    let message = `🎟️ *Upcoming Events* (showing ${eventsToShow.length} of ${events.length})\n\nPlease select an event by typing its ID, Name, or Date:\n\n`;
    
    eventsToShow.forEach(event => {
        // Use the helper function to parse the date correctly
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

    // Send instantly (no artificial delay)
    await sendMessageInstant(from, message);
}

async function listUpcomingEvents(from, supabase, user, showAll = false) {
    try {
        // Show loading message immediately (no delay)
        await sendMessageInstant(from, "🔄 *Fetching events...*\n\nPlease wait while I get the latest event information.");
        
        // Get ALL events but only display 5 initially
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
        return events; // Return ALL events, not just the displayed ones

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
    // Show loading message for sales report (instant)
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

    // Check if user has permission to view gross/net sales
    const canViewFinancials = hasFeaturePermission(user, 'view_gross_net_sales');

    // Use the helper function to parse the date correctly, then format it
    const eventDate = parseEventDate(event.event_date);
    const formattedDate = format(eventDate, 'MMMM d, yyyy');
    const eventName = event.event_name.split(',')[0];

    // Build comprehensive sales report
    let report = `📊 *SALES REPORT*\n\n*${event.event_id} - ${formattedDate} - ${eventName}*\n\n`;

    // Calculate totals
    const totalSales = (salesData.sales_total_ga || 0) + (salesData.sales_total_vip || 0);
    const totalComps = (salesData.sales_total_comp_ga || 0) + (salesData.sales_total_comp_vip || 0);
    const totalFree = (salesData.sales_total_free_ga || 0) + (salesData.sales_total_free_vip || 0);

    // Main sales section (always show if there are any sales)
    if (totalSales > 0 || salesData.sales_gross || salesData.sales_net || salesData.sales_total_coatcheck) {
        report += `*Total Sales:* ${totalSales}\n`;
        
        if (salesData.sales_total_ga) {
            report += `   - GA: ${salesData.sales_total_ga}\n`;
        }
        if (salesData.sales_total_vip) {
            report += `   - VIP: ${salesData.sales_total_vip}\n`;
        }
        if (salesData.sales_total_coatcheck) {
            report += `   - Coatcheck: ${salesData.sales_total_coatcheck}\n`;
        }
        
        // Only show financial data if user has permission
        if (canViewFinancials) {
            if (salesData.sales_gross) {
                report += `\n   - Gross: ${formatCurrency(salesData.sales_gross)}\n`;
            }
            if (salesData.sales_net) {
                report += `   - Net: ${formatCurrency(salesData.sales_net)}\n`;
            }
        } else {
            // Show placeholder for users without permission
            if (salesData.sales_gross || salesData.sales_net) {
                report += `\n   - Financial data: 🔒 *Manager Sales role required*\n`;
            }
        }
    }

    // Comps section (only show if there are comps)
    if (totalComps > 0) {
        report += `\n*Total Comps:* ${totalComps}\n`;
        
        if (salesData.sales_total_comp_ga) {
            report += `   - Comp GA: ${salesData.sales_total_comp_ga}\n`;
        }
        if (salesData.sales_total_comp_vip) {
            report += `   - Comp VIP: ${salesData.sales_total_comp_vip}\n`;
        }
    }

    // Free tickets section (only show if there are free tickets)
    if (totalFree > 0) {
        report += `\n*Total Free Tickets:* ${totalFree}\n`;
        
        if (salesData.sales_total_free_ga) {
            report += `   - Free GA: ${salesData.sales_total_free_ga}\n`;
        }
        if (salesData.sales_total_free_vip) {
            report += `   - Free VIP: ${salesData.sales_total_free_vip}\n`;
        }
    }

    // If no data at all
    if (totalSales === 0 && totalComps === 0 && totalFree === 0 && !salesData.sales_gross && !salesData.sales_net && !salesData.sales_total_coatcheck) {
        await sendMessage(from, "📊 *No Sales Data*\n\nThis event doesn't have any sales data recorded yet.");
        return;
    }

    // Send the report instantly
    await sendMessageInstant(from, report);
    
    // 💭 Add a natural pause with typing animation before asking the question
    await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second pause
    
    // Ask if they want to check another event with typing animation
    await sendMessage(from, "🔄 *Would you like to check another event?*\n\nType *yes* to see more events or *no* to exit.", 800);
}

async function handleSales(from, text, salesState, supabase, user) {
    // Handle when user is not in sales flow
    if (!salesState[from]) {
        // Start of the flow
        console.log(`🔍 Starting sales flow for user ${from}`);
        const events = await listUpcomingEvents(from, supabase, user);
        if (events && events.length > 0) {
            salesState[from] = { step: 'selecting_event', events };
        } else {
             // If no events, or an error occurred, end the flow
            delete salesState[from];
        }
        return salesState;
    }

    const state = salesState[from];
    const input = text.trim().toLowerCase();

    // Handle different steps in the sales flow
    if (state.step === 'selecting_event') {
        
        if (input === 'cancel') {
            delete salesState[from];
            await sendMessageInstant(from, "✅ *Sales lookup canceled.*");
            return salesState;
        }
        
        if (input === 'all') {
            console.log(`🔍 User ${from} requested all events`);
            await displayEventList(from, state.events, true);
            // Keep the same state since we already have all events loaded
            return salesState;
        }

        // Find the selected event from ALL events (not just displayed ones)
        const selectedEvent = state.events.find(
            e => e.event_id.toString() === input ||
            e.event_name.toLowerCase().split(',')[0].includes(input) ||
            format(parseEventDate(e.event_date), 'MMMM d').toLowerCase() === input
        );

        if (selectedEvent) {
            console.log(`🎯 User ${from} selected event: ${selectedEvent.event_name}`);
            await showSalesReport(from, supabase, selectedEvent, user);
            
            // Move to yes/no question step
            salesState[from] = { 
                step: 'asking_continue', 
                events: state.events,
                lastEvent: selectedEvent 
            };
        } else {
            await sendMessageInstant(from, "❌ *Invalid Selection*\n\nPlease type a valid Event ID, Name, or Date from the list.\n\nOr type *cancel* to exit.");
        }
    }
    
    // Handle yes/no response
    else if (state.step === 'asking_continue') {
        
        if (input === 'yes' || input === 'y' || input === 'yeah' || input === 'yep' || input === 'sure' || input === 'ok') {
            // User wants to check another event - show all events this time
            console.log(`🔄 User ${from} wants to check another event`);
            await displayEventList(from, state.events, true);
            salesState[from] = { step: 'selecting_event', events: state.events };
        }
        
        else if (input === 'no' || input === 'n' || input === 'nope' || input === 'exit' || input === 'cancel' || input === 'done') {
            // User wants to exit
            delete salesState[from];
            await sendMessage(from, "✅ *Thanks for using the sales module!*\n\nType *help* to see other available commands.", 400);
        }
        
        else {
            // Invalid response - ask again with typing animation
            await sendMessage(from, "❓ *Please respond with yes or no*\n\nType *yes* to check another event or *no* to exit.", 600);
        }
    }

    return salesState;
}

module.exports = handleSales;