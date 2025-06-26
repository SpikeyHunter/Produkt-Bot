// commands/promoter.js - Promoter ticket tracking command
const { sendMessage, sendMessageInstant } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');

// Define promoter mappings
const PROMOTER_MAPPINGS = {
  'Promoter - Parsa': 'Parsa',
  'Promoter - Jam': 'Jam', 
  'Promoter - Kerwin': 'Kerwin',
  'Promoter - Dom of Faith': 'DOF',
  'Promoter - The Neighbors': 'Neighbors'
};

async function handlePromoter(from, text, promoterState, supabase, user) {
  try {
    if (!promoterState[from]) {
      // Start promoter flow - fetch and display events
      promoterState[from] = { step: 1 };
      
      console.log(`🎫 Starting promoter flow for user ${from}`);
      
      // Fetch upcoming events using the same logic as sales command
      const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .gte('event_date', new Date().toISOString().split('T')[0])
        .order('event_date', { ascending: true });

      if (error) {
        console.error('Error fetching events for promoter:', error);
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.fetchError);
        delete promoterState[from];
        return promoterState;
      }

      if (!events || events.length === 0) {
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.noUpcomingEvents);
        delete promoterState[from];
        return promoterState;
      }

      // Store events for selection
      promoterState[from].events = events;
      
      // Format event list exactly like sales command
      let eventList = `🎫 *Upcoming Events* (${events.length})\n\nPlease select an event by typing its ID, Name, or Date:\n\n`;
      
      events.forEach(event => {
        const eventDate = new Date(event.event_date).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short', 
          day: 'numeric',
          year: 'numeric'
        });
        
        eventList += `🎵 *${event.event_name}*\n`;
        eventList += `📅 ${eventDate}\n`;
        eventList += `🆔 ID: ${event.event_id}\n\n`;
      });
      
      eventList += `Type *all* to see all upcoming events or *cancel* to exit.`;
      
      await sendMessage(from, eventList);
      return promoterState;
    }

    if (promoterState[from].step === 1) {
      // Handle event selection
      if (text.toLowerCase() === 'cancel') {
        delete promoterState[from];
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.promoterCanceled);
        return promoterState;
      }

      if (text.toLowerCase() === 'all') {
        // Show all events again (same as initial display)
        const events = promoterState[from].events;
        let eventList = `🎫 *All Upcoming Events* (${events.length})\n\n`;
        
        events.forEach(event => {
          const eventDate = new Date(event.event_date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric', 
            year: 'numeric'
          });
          
          eventList += `🎵 *${event.event_name}*\n`;
          eventList += `📅 ${eventDate}\n`;
          eventList += `🆔 ID: ${event.event_id}\n\n`;
        });
        
        eventList += `Please select an event by typing its ID, Name, or Date, or type *cancel* to exit.`;
        await sendMessage(from, eventList);
        return promoterState;
      }

      // Find selected event
      const events = promoterState[from].events;
      const input = text.toLowerCase().trim();
      
      let selectedEvent = null;
      
      // Try to match by ID first
      selectedEvent = events.find(event => 
        event.event_id.toString() === input
      );
      
      // Try to match by name
      if (!selectedEvent) {
        selectedEvent = events.find(event => 
          event.event_name.toLowerCase().includes(input)
        );
      }
      
      // Try to match by date
      if (!selectedEvent) {
        selectedEvent = events.find(event => {
          const eventDate = new Date(event.event_date).toLocaleDateString('en-US');
          return eventDate.toLowerCase().includes(input);
        });
      }

      if (!selectedEvent) {
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.selectionError);
        return promoterState;
      }

      // Fetch promoter orders for the selected event
      console.log(`🔍 Fetching promoter orders for event ${selectedEvent.event_id}`);
      
      const promoterNames = Object.keys(PROMOTER_MAPPINGS);
      
      const { data: orders, error: ordersError } = await supabase
        .from('events_orders')
        .select('order_serials, order_sales_item_name')
        .eq('event_id', selectedEvent.event_id)
        .in('order_sales_item_name', promoterNames);

      if (ordersError) {
        console.error('Error fetching promoter orders:', ordersError);
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.fetchError);
        delete promoterState[from];
        return promoterState;
      }

      if (!orders || orders.length === 0) {
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.noPromoterData);
        delete promoterState[from];
        return promoterState;
      }

      // Process orders and create CSV data
      const csvData = [];
      const foundPromoters = new Set();
      
      orders.forEach(order => {
        const promoterDisplayName = PROMOTER_MAPPINGS[order.order_sales_item_name];
        if (promoterDisplayName && order.order_serials) {
          foundPromoters.add(promoterDisplayName);
          
          // order_serials should be an array, but handle both array and string cases
          let serials = [];
          if (Array.isArray(order.order_serials)) {
            serials = order.order_serials;
          } else if (typeof order.order_serials === 'string') {
            try {
              serials = JSON.parse(order.order_serials);
            } catch (e) {
              serials = [order.order_serials];
            }
          }
          
          serials.forEach(serial => {
            csvData.push([serial, promoterDisplayName]);
          });
        }
      });

      if (csvData.length === 0) {
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.noPromoterData);
        delete promoterState[from];
        return promoterState;
      }

      // Create summary message
      const foundPromotersList = Array.from(foundPromoters).sort();
      let summaryMessage = `🎫 *Promoter Tickets Found:*\n\n`;
      foundPromotersList.forEach(promoter => {
        summaryMessage += `• ${promoter}\n`;
      });
      
      await sendMessage(from, summaryMessage);

      // Create CSV content
      const csvHeader = 'Serial Number,Promoter\n';
      const csvRows = csvData.map(row => `${row[0]},${row[1]}`).join('\n');
      const csvContent = csvHeader + csvRows;

      // Format filename
      const eventDate = new Date(selectedEvent.event_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).replace(/\//g, '-');
      
      const filename = `${selectedEvent.event_id}-${eventDate}-${selectedEvent.event_name.replace(/[^a-zA-Z0-9]/g, '_')}-Bracelets.csv`;

      // Send CSV file as a document (Note: This requires WhatsApp Business API media upload)
      // For now, send as formatted text since media upload needs additional setup
      let csvMessage = `📋 *CSV Export: ${filename}*\n\n`;
      csvMessage += `\`\`\`\n${csvContent}\n\`\`\`\n\n`;
      csvMessage += `Copy the above data to create your CSV file.`;
      
      await sendMessage(from, csvMessage);

      delete promoterState[from];
      return promoterState;
    }

  } catch (error) {
    console.error('Promoter command error:', error);
    const generalTemplates = templates.get('general');
    await sendMessage(from, generalTemplates.technicalIssue);
    delete promoterState[from];
  }

  return promoterState;
}

module.exports = handlePromoter;