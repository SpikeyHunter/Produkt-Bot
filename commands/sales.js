// commands/sales.js

const { sendMessage } = require('../utils');
const { format, toDate } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');

// Messages for the sales command
const MESSAGES = {
    fetchError: "⚠️ *Error*\n\nI couldn't fetch the event list right now. Please try again later.",
    noUpcomingEvents: "- No upcoming events found.",
    eventListHeader: (count) => `🎟️ *Upcoming Events* (${count})\n\nPlease select an event by typing its ID, Name, or Date.`,
    eventEntry: (event) => {
        const eventDate = toDate(new Date(event.event_date));
        // We need to account for the fact that the date in Supabase might be without timezone
        const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
        const formattedDate = format(zonedDate, 'MMMM d');
        const eventName = event.event_name.split(',')[0];
        return `${event.event_id} - ${formattedDate} - ${eventName}`;
    },
    askForSelection: "\nType *All* to see all upcoming events.",
    selectionError: "❌ *Invalid Selection*\n\nPlease type a valid Event ID, Name, or Date from the list, or type *cancel* to exit.",
    salesReportHeader: (event) => {
        const eventDate = toDate(new Date(event.event_date));
        const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
        const formattedDate = format(zonedDate, 'MMMM d, yyyy');
        const eventName = event.event_name.split(',')[0];
        return `*${event.event_id} - ${formattedDate} - ${eventName}*`;
    },
    salesReportLine: (label, value) => `   - ${label}: ${value || 'N/A'}`,
    totalSalesLine: (value) => `*Total Sales:* ${value || 'N/A'}`
};

/**
 * Fetches and displays a list of upcoming events.
 * @param {string} from - The user's phone number.
 * @param {object} supabase - The Supabase client.
 * @param {boolean} showAll - Whether to show all upcoming events or just the next 5.
 * @returns {Promise<Array|null>} A promise that resolves to the list of events, or null on error.
 */
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
            await sendMessage(from, MESSAGES.fetchError);
            return null;
        }

        if (!events || events.length === 0) {
            await sendMessage(from, MESSAGES.noUpcomingEvents);
            return [];
        }

        let message = MESSAGES.eventListHeader(events.length) + '\n\n';
        message += events.map(MESSAGES.eventEntry).join('\n');
        
        if (!showAll) {
            message += '\n\n' + MESSAGES.askForSelection;
        }

        await sendMessage(from, message);
        return events;

    } catch (e) {
        console.error("Exception in listUpcomingEvents:", e);
        await sendMessage(from, MESSAGES.fetchError);
        return null;
    }
}

/**
 * Displays the sales report for a specific event.
 * @param {string} from - The user's phone number.
 * @param {object} supabase - The Supabase client.
 * @param {object} event - The selected event object.
 */
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

    let report = MESSAGES.salesReportHeader(event) + '\n\n';
    report += MESSAGES.totalSalesLine(grossSales) + '\n';
    report += MESSAGES.salesReportLine('GA', salesData.sales_total_ga);
    report += MESSAGES.salesReportLine('VIP', salesData.sales_total_vip);
    report += MESSAGES.salesReportLine('Coatcheck', salesData.sales_total_coatcheck);

    await sendMessage(from, report);
}


/**
 * Handles the 'sales' command flow.
 * @param {string} from - The user's phone number.
 * @param {string} text - The user's message.
 * @param {object} salesState - The current state for the sales command.
 * @param {object} supabase - The Supabase client.
 * @param {object} user - The user object from the database.
 * @returns {object} The updated sales state.
 */
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
            await sendMessage(from, MESSAGES.selectionError);
        }
    }

    return salesState;
}

module.exports = handleSales;