// commands/sales.js - ZERO hardcoded messages
const { sendMessage } = require('../utils');
const { format, toDate } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');
const templates = require('../templates/templateLoader');

async function listUpcomingEvents(from, supabase, showAll = false) {
    try {
        const salesTemplates = templates.get('sales');
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
            await sendMessage(from, salesTemplates.fetchError);
            return null;
        }

        if (!events || events.length === 0) {
            await sendMessage(from, salesTemplates.noUpcomingEvents);
            return [];
        }

        // Build message using templates
        const headerMessage = templates.get('sales', { count: events.length }).eventListHeader;
        let message = headerMessage + '\n\n';
        
        events.forEach(event => {
            const eventDate = toDate(new Date(event.event_date));
            const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
            const formattedDate = format(zonedDate, 'MMMM d');
            const eventName = event.event_name.split(',')[0];
            message += `${event.event_id} - ${formattedDate} - ${eventName}\n`;
        });
        
        if (!showAll) {
            message += salesTemplates.askForSelection;
        }

        await sendMessage(from, message);
        return events;

    } catch (e) {
        console.error("Exception in listUpcomingEvents:", e);
        const salesTemplates = templates.get('sales');
        await sendMessage(from, salesTemplates.fetchError);
        return null;
    }
}

async function showSalesReport(from, supabase, event) {
    const salesTemplates = templates.get('sales');
    
    const { data: salesData, error } = await supabase
        .from('events_sales')
        .select('*')
        .eq('event_id', event.event_id)
        .single();

    if (error || !salesData) {
        console.error("Error fetching sales data:", error);
        await sendMessage(from, salesTemplates.noSalesData);
        return;
    }

    const grossSales = (salesData.sales_gross || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const eventDate = toDate(new Date(event.event_date));
    const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
    const formattedDate = format(zonedDate, 'MMMM d, yyyy');
    const eventName = event.event_name.split(',')[0];

    // Build report using templates
    const reportHeader = templates.get('sales', {
        eventId: event.event_id,
        date: formattedDate,
        name: eventName
    }).salesReportHeader;

    const totalSalesLine = templates.get('sales', { amount: grossSales }).totalSalesLine;
    
    const gaLine = templates.get('sales', { 
        label: 'GA', 
        value: salesData.sales_total_ga || 'N/A' 
    }).salesReportLine;
    
    const vipLine = templates.get('sales', { 
        label: 'VIP', 
        value: salesData.sales_total_vip || 'N/A' 
    }).salesReportLine;
    
    const coatcheckLine = templates.get('sales', { 
        label: 'Coatcheck', 
        value: salesData.sales_total_coatcheck || 'N/A' 
    }).salesReportLine;

    const report = `${reportHeader}\n\n${totalSalesLine}\n${gaLine}\n${vipLine}\n${coatcheckLine}`;
    await sendMessage(from, report);
}

async function handleSales(from, text, salesState, supabase, user) {
    const salesTemplates = templates.get('sales');
    
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
            await sendMessage(from, salesTemplates.salesCanceled);
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
            await sendMessage(from, salesTemplates.selectionError);
        }
    }

    return salesState;
}

module.exports = handleSales;