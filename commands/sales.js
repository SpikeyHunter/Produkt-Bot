// commands/sales.js - Enhanced with smart event matching and command flow
const { sendMessage, sendMessageInstant, parseCommandWithSuggestions } = require('../utils');
const { format } = require('date-fns');
const { fromZonedTime, toZonedTime } = require('date-fns-tz');
const templates = require('../templates/templateLoader');
const { hasFeaturePermission, formatCurrency } = require('./botbasic')

// Helper function to normalize text for matching (removes accents, special chars)
function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^\w\s]/g, '') // Remove special characters
        .trim();
}

// Helper function to find matching events with fuzzy logic
function findMatchingEvents(input, events) {
    const normalizedInput = normalizeText(input);
    const matches = [];

    events.forEach(event => {
        const eventName = event.event_name.split(',')[0];
        const normalizedEventName = normalizeText(eventName);
        
        // Exact match
        if (normalizedEventName === normalizedInput) {
            matches.push({ event, score: 100, type: 'exact' });
            return;
        }
        
        // Event ID match
        if (event.event_id.toString() === input) {
            matches.push({ event, score: 100, type: 'id' });
            return;
        }
        
        // Date match
        const [year, month, day] = event.event_date.split('-');
        const eventDate = new Date(year, month - 1, day);
        const formattedDate = format(eventDate, 'MMMM d').toLowerCase();
        if (formattedDate === normalizedInput) {
            matches.push({ event, score: 100, type: 'date' });
            return;
        }
        
        // Partial match - event name starts with input
        if (normalizedEventName.startsWith(normalizedInput)) {
            const score = Math.round((normalizedInput.length / normalizedEventName.length) * 90);
            matches.push({ event, score, type: 'starts_with' });
            return;
        }
        
        // Contains match - event name contains input
        if (normalizedEventName.includes(normalizedInput) && normalizedInput.length >= 2) {
            const score = Math.round((normalizedInput.length / normalizedEventName.length) * 70);
            matches.push({ event, score, type: 'contains' });
            return;
        }
    });

    // Sort by score (highest first) and return
    return matches.sort((a, b) => b.score - a.score);
}

async function listUpcomingEvents(from, supabase, user, showAll = false) {
    try {
        // Show loading message immediately (no delay)
        await sendMessageInstant(from, "🔄 *Fetching events...*\n\nPlease wait while I get the latest event information.");
        
        // Use user's timezone or default to Eastern
        const userTimezone = user?.bot_user_timezone || 'America/New_York';
        
        const today = new Date();
        const todayInUserTZ = toZonedTime(today, userTimezone);
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

        // Build message using correct date parsing (no timezone conversion for event dates)
        let message = `🎟️ *Upcoming Events* (${events.length})\n\nPlease select an event by typing its ID, Name, or Date:\n\n`;
        
        events.forEach(event => {
            // Parse date as local date (no timezone conversion needed for event dates)
            const [year, month, day] = event.event_date.split('-');
            const eventDate = new Date(year, month - 1, day);
            const formattedDate = format(eventDate, 'MMMM d');
            const eventName = event.event_name.split(',')[0];
            message += `${event.event_id} - ${formattedDate} - ${eventName}\n`;
        });
        
        if (!showAll) {
            message += '\nType *all* to see all upcoming events or *cancel* to exit.';
        } else {
            message += '\nType *cancel* to exit.';
        }

        // Send instantly (no artificial delay)
        await sendMessageInstant(from, message);
        return events;

    } catch (e) {
        console.error("Exception in listUpcomingEvents:", e);
        await sendMessage(from, "⚠️ *Connection Error*\n\nI'm having trouble connecting to our systems right now. Please try again in a few moments.");
        return null;
    }
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

    // Parse date as local date (no timezone conversion needed for event dates)
    const [year, month, day] = event.event_date.split('-');
    const eventDate = new Date(year, month - 1, day);
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
    
    // Enhanced continuation prompt
    await sendMessage(from, "🔄 *What would you like to do next?*\n\nType:\n• *yes* - See all events\n• *no* - Exit sales\n• Event name - Check specific event\n• Any other command", 800);
}

async function handleEventSelection(from, input, events, supabase, user) {
    const matches = findMatchingEvents(input, events);
    
    if (matches.length === 0) {
        await sendMessageInstant(from, "❌ *No Events Found*\n\nNo events match \"" + input + "\".\n\nPlease try a different name or type *all* to see all events.");
        return null;
    }
    
    if (matches.length === 1 || matches[0].score === 100) {
        // Single exact match or very high confidence
        const selectedEvent = matches[0].event;
        console.log(`🎯 User ${from} selected event: ${selectedEvent.event_name} (${matches[0].type} match)`);
        await showSalesReport(from, supabase, selectedEvent, user);
        return selectedEvent;
    }
    
    // Multiple matches - show suggestions
    let suggestionMessage = `🔍 *Multiple events found for "${input}"*\n\nDid you mean:\n\n`;
    
    // Show top 5 matches
    const topMatches = matches.slice(0, 5);
    topMatches.forEach((match, index) => {
        const [year, month, day] = match.event.event_date.split('-');
        const eventDate = new Date(year, month - 1, day);
        const formattedDate = format(eventDate, 'MMMM d');
        const eventName = match.event.event_name.split(',')[0];
        suggestionMessage += `${index + 1}. ${match.event.event_id} - ${formattedDate} - ${eventName}\n`;
    });
    
    suggestionMessage += '\nType the number, full name, or ID of the event you want.';
    await sendMessageInstant(from, suggestionMessage);
    
    return { type: 'suggestions', matches: topMatches };
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
            const allEvents = await listUpcomingEvents(from, supabase, user, true);
            if (allEvents && allEvents.length > 0) {
                salesState[from] = { step: 'selecting_event', events: allEvents };
            } else {
                delete salesState[from];
            }
            return salesState;
        }

        // Handle suggestions selection (if user is selecting from previous suggestions)
        if (state.suggestions && /^[1-5]$/.test(input)) {
            const suggestionIndex = parseInt(input) - 1;
            if (suggestionIndex < state.suggestions.length) {
                const selectedEvent = state.suggestions[suggestionIndex].event;
                console.log(`🎯 User ${from} selected suggested event: ${selectedEvent.event_name}`);
                await showSalesReport(from, supabase, selectedEvent, user);
                
                // Move to continuation step
                salesState[from] = { 
                    step: 'asking_continue', 
                    events: state.events,
                    lastEvent: selectedEvent 
                };
                return salesState;
            }
        }

        // Smart event matching
        const result = await handleEventSelection(from, text.trim(), state.events, supabase, user);
        
        if (result === null) {
            // No match found, stay in same step
            return salesState;
        }
        
        if (result.type === 'suggestions') {
            // Multiple matches found, save suggestions
            salesState[from] = { 
                step: 'selecting_event', 
                events: state.events,
                suggestions: result.matches
            };
            return salesState;
        }
        
        // Single event selected successfully
        salesState[from] = { 
            step: 'asking_continue', 
            events: state.events,
            lastEvent: result 
        };
    }
    
    // Handle continuation response
    else if (state.step === 'asking_continue') {
        
        if (input === 'yes' || input === 'y' || input === 'yeah' || input === 'yep' || input === 'sure' || input === 'ok') {
            // User wants to see all events
            console.log(`🔄 User ${from} wants to see all events`);
            const events = await listUpcomingEvents(from, supabase, user, true);
            if (events && events.length > 0) {
                salesState[from] = { step: 'selecting_event', events };
            } else {
                delete salesState[from];
            }
            return salesState;
        }
        
        if (input === 'no' || input === 'n' || input === 'nope' || input === 'exit' || input === 'cancel' || input === 'done') {
            // User wants to exit
            delete salesState[from];
            await sendMessage(from, "✅ *Thanks for using the sales module!*\n\nType *help* to see other available commands.", 400);
            return salesState;
        }
        
        // Check if it's another command
        const commandResult = parseCommandWithSuggestions(text, user);
        if (commandResult.command) {
            // User typed another command, exit sales flow and let main handler process it
            delete salesState[from];
            console.log(`🔄 User ${from} switched to command: ${commandResult.command}`);
            // Return special flag to indicate command switch
            return { ...salesState, _commandSwitch: { from, command: commandResult.command, text } };
        }
        
        // Try to match as event name directly
        const result = await handleEventSelection(from, text.trim(), state.events, supabase, user);
        
        if (result === null) {
            // No match found, ask again
            await sendMessage(from, "❓ *Please choose an option*\n\nType:\n• *yes* - See all events\n• *no* - Exit\n• Event name - Check specific event\n• Any command (help, status, etc.)", 600);
            return salesState;
        }
        
        if (result.type === 'suggestions') {
            // Multiple matches found, save suggestions and stay in same step
            salesState[from] = { 
                step: 'asking_continue', 
                events: state.events,
                lastEvent: state.lastEvent,
                suggestions: result.matches
            };
            return salesState;
        }
        
        // Single event selected successfully, stay in continuation step
        salesState[from] = { 
            step: 'asking_continue', 
            events: state.events,
            lastEvent: result 
        };
    }

    return salesState;
}

module.exports = handleSales;