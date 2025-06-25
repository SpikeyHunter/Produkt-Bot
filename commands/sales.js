// commands/sales.js - Fixed with proper imports and user timezone
const { sendMessage } = require('../utils');
const { format } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');
const templates = require('../templates/templateLoader');

async function listUpcomingEvents(from, supabase, user, showAll = false) {
    try {
        // Show loading message immediately
        await sendMessage(from, "🔄 *Fetching events...*\n\nPlease wait while I get the latest event information.");
        
        // Use user's timezone or default to Eastern
        const userTimezone = user?.bot_user_timezone || 'America/New_York';
        
        const today = new Date();
        const todayInUserTZ = utcToZonedTime(today, userTimezone);
        const todayDateString = format(todayInUserTZ, 'yyyy-MM-dd');

        let query = supabase
            .from('events')
            .select('event_id, event_name, event_date')
            .gte('event_date', todayDateString)
            .order('event_date', { ascending: true });

        if (!showAll) {
            query = query.limit(5);
        }

        const { data: events, error } = await query;

        if (error) {
            console.error("Error fetching upcoming events:", error);
            await sendMessage(from, "❌ *Database Error*\n\nI couldn't fetch the event list from our database. Please try again in a moment.");
            return null;
        }

        if (!events || events.length === 0) {
            await sendMessage(from, "📅 *No Upcoming Events*\n\nThere are no upcoming events scheduled at this time.");
            return [];
        }

        // Build message using user's timezone
        let message = `🎟️ *Upcoming Events* (${events.length})\n\nPlease select an event by typing its ID, Name, or Date:\n\n`;
        
        events.forEach(event => {
            const eventDate = new Date(event.event_date);
            const zonedDate = utcToZonedTime(eventDate, userTimezone);
            const formattedDate = format(zonedDate, 'MMMM d');
            const eventName = event.event_name.split(',')[0];
            message += `${event.event_id} - ${formattedDate} - ${eventName}\n`;
        });
        
        if (!showAll) {
            message += '\nType *all* to see all upcoming events or *cancel* to exit.';
        }

        await sendMessage(from, message);
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
    // Show loading message for sales report
    await sendMessage(from, "📊 *Loading sales data...*\n\nRetrieving sales information for this event.");
    
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

    // Use user's timezone for date formatting
    const userTimezone = user?.bot_user_timezone || 'America/New_York';
    const eventDate = new Date(event.event_date);
    const zonedDate = utcToZonedTime(eventDate, userTimezone);
    const formattedDate = format(zonedDate, 'MMMM d, yyyy');
    const eventName = event.event_name.split(',')[0];

    // Build comprehensive sales report
    let report = `*${event.event_id} - ${formattedDate} - ${eventName}*\n\n`;

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
        
        if (salesData.sales_gross) {
            report += `   - Gross: ${formatCurrency(salesData.sales_gross)}\n`;
        }
        if (salesData.sales_net) {
            report += `   - Net: ${formatCurrency(salesData.sales_net)}\n`;
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

    await sendMessage(from, report);
}

async function handleSales(from, text, salesState, supabase, user) {
    if (!salesState[from]) {
        // Start of the flow
        const events = await listUpcomingEvents(from, supabase, user);
        if (events && events.length > 0) {
            salesState[from] = { step: 1, events };
        } else {
             // If no events, or an error occurred, end the flow
            delete salesState[from];
        }
        return salesState;
    }

    const state = salesState[from];

    if (state.step === 1) {
        const input = text.trim().toLowerCase();
        
        if(input === 'cancel'){
            delete salesState[from];
            await sendMessage(from, "✅ *Sales lookup canceled.*");
            return salesState;
        }
        
        if (input === 'all') {
            const allEvents = await listUpcomingEvents(from, supabase, user, true);
            if (allEvents && allEvents.length > 0) {
                 salesState[from] = { step: 1, events: allEvents };
            } else {
                 delete salesState[from];
            }
            return salesState;
        }

        // Use user's timezone for date comparison
        const userTimezone = user?.bot_user_timezone || 'America/New_York';

        // Find the selected event
        const selectedEvent = state.events.find(
            e => e.event_id.toString() === input ||
            e.event_name.toLowerCase().split(',')[0].includes(input) ||
            format(utcToZonedTime(new Date(e.event_date), userTimezone), 'MMMM d').toLowerCase() === input
        );

        if (selectedEvent) {
            await showSalesReport(from, supabase, selectedEvent, user);
            delete salesState[from]; // End of flow
        } else {
            await sendMessage(from, "❌ *Invalid Selection*\n\nPlease type a valid Event ID, Name, or Date from the list above.\n\nOr type *cancel* to exit.");
        }
    }

    return salesState;
}

module.exports = handleSales;