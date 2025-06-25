// commands/sales.js - Updated with complete sales report
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
            const salesTemplates = templates.get('sales');
            await sendMessage(from, salesTemplates.fetchError);
            return null;
        }

        if (!events || events.length === 0) {
            const salesTemplates = templates.get('sales');
            await sendMessage(from, salesTemplates.noUpcomingEvents);
            return [];
        }

        // Build message using templates with variables
        const salesTemplates = templates.get('sales', { count: events.length });
        let message = salesTemplates.eventListHeader + '\n\n';
        
        events.forEach(event => {
            const eventDate = toDate(new Date(event.event_date));
            const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
            const formattedDate = format(zonedDate, 'MMMM d');
            const eventName = event.event_name.split(',')[0];
            message += `${event.event_id} - ${formattedDate} - ${eventName}\n`;
        });
        
        if (!showAll) {
            const salesTemplatesForSelection = templates.get('sales');
            message += '\n' + salesTemplatesForSelection.askForSelection;
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

function formatCurrency(amount) {
    if (!amount || amount === 0) return null;
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

async function showSalesReport(from, supabase, event) {
    const { data: salesData, error } = await supabase
        .from('events_sales')
        .select('*')
        .eq('event_id', event.event_id)
        .single();

    if (error || !salesData) {
        console.error("Error fetching sales data:", error);
        const salesTemplates = templates.get('sales');
        await sendMessage(from, salesTemplates.noSalesData);
        return;
    }

    const eventDate = toDate(new Date(event.event_date));
    const zonedDate = utcToZonedTime(eventDate, 'America/New_York');
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
        const salesTemplates = templates.get('sales');
        await sendMessage(from, salesTemplates.noSalesData);
        return;
    }

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
            const salesTemplates = templates.get('sales');
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
            const salesTemplates = templates.get('sales');
            await sendMessage(from, salesTemplates.selectionError);
        }
    }

    return salesState;
}

module.exports = handleSales;