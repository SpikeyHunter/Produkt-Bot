// commands/promoter.js - Promoter ticket tracking command
const { sendMessage, sendMessageInstant } = require('../utils');
const templates = require('../templates/templateLoader');
const database = require('../scripts/database');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');

// Define promoter mappings
const PROMOTER_MAPPINGS = {
  'Promoter - Parsa': 'Pars',
  'Promoter - Jam': 'Jam', 
  'Promoter - Kerwin': 'Kerw',
  'Promoter - Dom of Faith': 'DOF',
  'Promoter - The Neighbors': 'Neigh'
};

async function uploadMediaToWhatsApp(filePath, filename) {
  try {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    if (!accessToken || !phoneNumberId) {
      throw new Error('WhatsApp credentials not configured');
    }

    const fileBuffer = await fs.readFile(filePath);
    
    // Create multipart form data boundary
    const boundary = '----formdata-' + Math.random().toString(36);
    
    // Build form data manually
    let formData = '';
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="messaging_product"\r\n\r\n`;
    formData += `whatsapp\r\n`;
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="type"\r\n\r\n`;
    formData += `document\r\n`;
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    formData += `Content-Type: text/csv\r\n\r\n`;
    
    const formDataBuffer = Buffer.concat([
      Buffer.from(formData, 'utf8'),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    ]);

    return new Promise((resolve, reject) => {
      const postData = formDataBuffer;
      
      const options = {
        hostname: 'graph.facebook.com',
        port: 443,
        path: `/v18.0/${phoneNumberId}/media`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': postData.length
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(result.id);
            } else {
              reject(new Error(`Media upload failed: ${result.error?.message || 'Unknown error'}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('Media upload error:', error);
    throw error;
  }
}

async function sendDocument(to, mediaId, filename, caption = '') {
  try {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'document',
      document: {
        id: mediaId,
        filename: filename,
        caption: caption
      }
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'graph.facebook.com',
        port: 443,
        path: `/v18.0/${phoneNumberId}/messages`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(result);
            } else {
              reject(new Error(`Document send failed: ${result.error?.message || 'Unknown error'}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(payload);
      req.end();
    });
  } catch (error) {
    console.error('Document send error:', error);
    throw error;
  }
}

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
      
      // Format event list in compact style
      let eventList = `🎫 *Upcoming Events* (${events.length})\n\nPlease select an event by typing its ID, Name, or Date:\n\n`;
      
      events.forEach(event => {
        const eventDate = new Date(event.event_date).toLocaleDateString('en-US', {
          month: 'short', 
          day: 'numeric'
        });
        
        eventList += `${event.event_id} - ${eventDate} - ${event.event_name}\n`;
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
        // Show all events again in compact format
        const events = promoterState[from].events;
        let eventList = `🎫 *All Upcoming Events* (${events.length})\n\n`;
        
        events.forEach(event => {
          const eventDate = new Date(event.event_date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          });
          
          eventList += `${event.event_id} - ${eventDate} - ${event.event_name}\n`;
        });
        
        eventList += `\nPlease select an event by typing its ID, Name, or Date, or type *cancel* to exit.`;
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

      // Force refresh order data before querying
      console.log(`🔄 Syncing latest order data for event ${selectedEvent.event_id}...`);
      try {
        // Run the ORDER sync script specifically for this event
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        
        // Force update the event order timestamp to trigger re-sync
        await supabase
          .from('events')
          .update({ event_order_updated: '2020-01-01 00:00:00' })
          .eq('event_id', selectedEvent.event_id);
        
        // Run the event-orders.js script to sync order data
        await execPromise('node event-orders.js update');
        
        console.log('✅ Event orders synced successfully before promoter query');
      } catch (syncError) {
        console.log('⚠️ Order sync failed, proceeding with existing data:', syncError);
        // Continue anyway - don't let sync failure block the promoter command
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
        console.log(`Processing order: ${order.order_sales_item_name} -> ${promoterDisplayName}`);
        
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
              console.log('Failed to parse serials as JSON, treating as single serial:', e);
              serials = [order.order_serials];
            }
          }
          
          console.log(`Found ${serials.length} serials for ${promoterDisplayName}`);
          
          serials.forEach(serial => {
            csvData.push([serial, promoterDisplayName]);
          });
        } else {
          console.log(`No mapping found for: ${order.order_sales_item_name} or no serials`);
        }
      });

      console.log(`Total CSV rows created: ${csvData.length}`);
      console.log(`Found promoters: ${Array.from(foundPromoters).join(', ')}`);

      if (csvData.length === 0) {
        // Better error message showing what was actually found
        let debugMessage = `🔍 *Debug Info:*\n\n`;
        debugMessage += `Found ${orders.length} orders in database:\n`;
        orders.forEach(order => {
          debugMessage += `• ${order.order_sales_item_name}\n`;
        });
        debugMessage += `\nExpected promoter names:\n`;
        Object.keys(PROMOTER_MAPPINGS).forEach(name => {
          debugMessage += `• ${name}\n`;
        });
        await sendMessage(from, debugMessage);
        
        const promoterTemplates = templates.get('promoter');
        await sendMessage(from, promoterTemplates.noPromoterData);
        delete promoterState[from];
        return promoterState;
      }

      // Create summary message
      const foundPromotersList = Array.from(foundPromoters).sort();
      let summaryMessage = `🎫 *Promoter Tickets Found:*\n\n`;
      foundPromotersList.forEach(promoter => {
        const count = csvData.filter(row => row[1] === promoter).length;
        summaryMessage += `• ${promoter}: ${count} tickets\n`;
      });
      summaryMessage += `\nTotal: ${csvData.length} tickets\n`;
      
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

      try {
        // Create temporary CSV file
        const tempDir = path.join(__dirname, '..', 'temp');
        await fs.mkdir(tempDir, { recursive: true });
        const tempFilePath = path.join(tempDir, filename);
        
        // Write CSV to file
        await fs.writeFile(tempFilePath, csvContent, 'utf8');
        console.log(`📁 Created CSV file: ${tempFilePath}`);

        // Upload to WhatsApp and send as document
        console.log('📤 Uploading CSV to WhatsApp...');
        const mediaId = await uploadMediaToWhatsApp(tempFilePath, filename);
        console.log(`✅ Media uploaded successfully: ${mediaId}`);

        const caption = `📋 Promoter ticket list for ${selectedEvent.event_name}\n\n${foundPromotersList.map(p => `• ${p}: ${csvData.filter(row => row[1] === p).length} tickets`).join('\n')}\n\nTotal: ${csvData.length} tickets`;
        
        await sendDocument(from, mediaId, filename, caption);
        console.log('✅ CSV file sent successfully');

        // Clean up temporary file
        await fs.unlink(tempFilePath);
        console.log('🗑️ Temporary file cleaned up');

      } catch (fileError) {
        console.error('Error creating/sending CSV file:', fileError);
        
        // Fallback to text format if file upload fails
        let csvMessage = `📋 *CSV Export: ${filename}*\n\n`;
        csvMessage += `⚠️ File upload failed, sending as text:\n\n`;
        csvMessage += `\`\`\`\n${csvContent}\n\`\`\`\n\n`;
        csvMessage += `Copy the above data to create your CSV file.`;
        
        await sendMessage(from, csvMessage);
      }

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