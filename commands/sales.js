// commands/sales.js - Sales command with templates
const { sendMessage } = require('../utils');
const { format, toDate } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');
const templates = require('../templates/templateLoader');

async function listUpcomingEvents(from, supabase, showAll = false) {
    try {
        const today = new Date();
        const todayInET = utcToZonedTime(today, 'America/New_York');
        const todayDateString = format(todayInET, 'yyyy-MM-dd');

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
            await sendMessage(from, "⚠️ *Error*\n\nI couldn't fetch the event list right now. Please try again later.");
            return null;
        }

        if (!events || events.length === 0) {
            await sendMessage(from, "📅 *No Upcoming Events*\n\nThere are no upcoming events found at this time.");
            return [];
        }

        let message = `🎟️ *Upcoming Events* (${events.length})\n\nPlease select an event by typing its ID, Name, or Date.\n\n`;
        
        events.forEach(event => {
            const eventDate = toDate(new Date(event.event_date));
            const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
            const formattedDate = format(zonedDate, 'MMMM d');
            const eventName = event.event_name.split(',')[0];
            message += `${event.event_id} - ${formattedDate} - ${eventName}\n`;
        });
        
        if (!showAll) {
            message += '\nType *All* to see all upcoming events.';
        }

        await sendMessage(from, message);
        return events;

    } catch (e) {
        console.error("Exception in listUpcomingEvents:", e);
        await sendMessage(from, "⚠️ *Error*\n\nI couldn't fetch the event list right now. Please try again later.");
        return null;
    }
}

async function showSalesReport(from, supabase, event) {
    const { data: salesData, error } = await supabase
        .from('events_sales')
        .select('*')
        .eq('event_id', event.event_id)
        .single();

    if (error || !salesData) {
        console.error("Error fetching sales data:", error);
        await sendMessage(from, "⚠️ Could not retrieve sales data for this event.");
        return;
    }

    const grossSales = (salesData.sales_gross || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

    const eventDate = toDate(new Date(event.event_date));
    const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
    const formattedDate = format(zonedDate, 'MMMM d, yyyy');
    const eventName = event.event_name.split(',')[0];

    let report = `*${event.event_id} - ${formattedDate} - ${eventName}*\n\n`;
    report += `*Total Sales:* ${grossSales}\n`;
    report += `   - GA: ${salesData.sales_total_ga || 'N/A'}\n`;
    report += `   - VIP: ${salesData.sales_total_vip || 'N/A'}\n`;
    report += `   - Coatcheck: ${salesData.sales_total_coatcheck || 'N/A'}`;

    await sendMessage(from, report);
}

async function handleSales(from, text, salesState, supabase, user) {
    if (!salesState[from]) {
        // Start of the flow
        const events = await listUpcomingEvents(from, supabase);
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
            await sendMessage(from, "✅ Sales command canceled.");
            return salesState;
        }
        
        if (input === 'all') {
            const allEvents = await listUpcomingEvents(from, supabase, true);
            if (allEvents && allEvents.length > 0) {
                 salesState[from] = { step: 1, events: allEvents };
            } else {
                 delete salesState[from];
            }
            return salesState;
        }

        // Find the selected event
        const selectedEvent = state.events.find(
            e => e.event_id.toString() === input ||
            e.event_name.toLowerCase().split(',')[0].includes(input) ||
            format(utcToZonedTime(toDate(new Date(e.event_date)), 'America/New_York'), 'MMMM d').toLowerCase() === input
        );

        if (selectedEvent) {
            await showSalesReport(from, supabase, selectedEvent);
            delete salesState[from]; // End of flow
        } else {
            await sendMessage(from, "❌ *Invalid Selection*\n\nPlease type a valid Event ID, Name, or Date from the list, or type *cancel* to exit.");
        }
    }

    return salesState;
}

module.exports = handleSales;