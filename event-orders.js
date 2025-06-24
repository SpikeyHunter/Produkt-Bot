const axios = require("axios");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (error) {
    console.log('dotenv not available, using system environment variables');
  }
}

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY; 
const GROUP_ID = process.env.TIXR_GROUP_ID || '980';
const CPK = process.env.TIXR_CPK;
const SECRET_KEY = process.env.TIXR_SECRET_KEY;

// Validation
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CPK || !SECRET_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Initialize
axios.defaults.timeout = 8000;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Parse arguments
const args = process.argv.slice(2);
const command = args[0];

if (command !== 'update') {
  console.error("Usage: node event-orders.js update");
  process.exit(1);
}

// Build Tixr hash
function buildHash(basePath, params) {
  const sorted = Object.keys(params)
    .sort()
    .map(k => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  
  return crypto.createHmac("sha256", SECRET_KEY)
    .update(`${basePath}?${sorted}`)
    .digest("hex");
}

// Fetch orders from Tixr
async function fetchOrders(eventId, fromDate = null) {
  const startDate = fromDate ? new Date(fromDate).toISOString().split('T')[0] : "2020-01-01";
  const basePath = `/v1/groups/${GROUP_ID}/events/${eventId}/orders`;
  const params = {
    cpk: CPK,
    t: Date.now(),
    page_number: 1,
    page_size: 1000,
    start_date: startDate
  };
  
  const sorted = Object.keys(params)
    .sort()
    .map(k => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  const hash = buildHash(basePath, params);
  const url = `https://studio.tixr.com${basePath}?${sorted}&hash=${hash}`;
  
  try {
    const response = await axios.get(url);
    const orders = (response.data || []).filter(order => order.status === "COMPLETE");
    
    if (fromDate) {
      const fromMs = new Date(fromDate).getTime();
      return orders.filter(order => parseInt(order.purchase_date) >= fromMs);
    }
    
    return orders;
  } catch (error) {
    console.error(`Error fetching orders for event ${eventId}:`, error.message);
    return [];
  }
}

// Transform orders for database
function transformOrders(orders, eventId) {
  const transformed = [];
  
  for (const order of orders) {
    if (!order.sale_items?.length) continue;
    
    for (const item of order.sale_items) {
      transformed.push({
        event_id: parseInt(eventId),
        order_sale_id: item.sale_id || null,
        order_tier_id: item.tier_id || null,
        order_category: item.category || null,
        order_quantity: item.quantity || null,
        order_sales_item_name: item.name || null,
        order_serials: null,
        order_name: order.order_id || null,
        order_gross: item.total || null,
        order_net: item.net || null,
        order_purchase_date: order.purchase_date ? new Date(parseInt(order.purchase_date)).toISOString() : null,
        order_user_id: null,
        order_user_agent: order.user_agent_type || null,
        order_card_type: order.card_type || null,
        order_ref: order.referrer || null,
        order_ref_type: order.ref_type || null,
        order_checkin: null
      });
    }
  }
  
  return transformed;
}

// Get existing orders
async function getExistingOrders(eventId) {
  const { data } = await supabase
    .from("events_orders")
    .select("order_name, order_sale_id")
    .eq("event_id", eventId);
    
  const existing = new Set();
  if (data) {
    data.forEach(order => {
      existing.add(`${order.order_name || "null"}_${order.order_sale_id || "null"}`);
    });
  }
  
  return existing;
}

// Insert orders
async function insertOrders(orders, existingOrders) {
  if (!orders.length) return { inserted: 0, skipped: 0 };
  
  const toInsert = orders.filter(order => {
    const key = `${order.order_name || "null"}_${order.order_sale_id || "null"}`;
    return !existingOrders.has(key);
  });
  
  if (!toInsert.length) {
    return { inserted: 0, skipped: orders.length };
  }
  
  try {
    const { error } = await supabase
      .from("events_orders")
      .insert(toInsert);
      
    if (error) {
      console.error("Insert error:", error.message);
      return { inserted: 0, skipped: orders.length };
    }
    
    return { inserted: toInsert.length, skipped: orders.length - toInsert.length };
  } catch (err) {
    console.error("Insert exception:", err.message);
    return { inserted: 0, skipped: orders.length };
  }
}

// Save sales summary
async function saveSalesSummary(eventId) {
  const { data: allOrders } = await supabase
    .from("events_orders")
    .select("*")
    .eq("event_id", eventId);
  
  if (!allOrders?.length) return;
  
  const paidOrders = allOrders.filter(order => 
    (order.order_gross && order.order_gross > 0) || 
    (order.order_net && order.order_net > 0)
  );
  
  let paidGA = 0, paidVIP = 0, paidOUTLET = 0;
  let totalGross = 0, totalNet = 0;
  
  paidOrders.forEach(order => {
    const quantity = order.order_quantity || 1;
    
    if (order.order_gross) totalGross += order.order_gross;
    if (order.order_net) totalNet += order.order_net;
    
    if (order.order_category === 'GA') paidGA += quantity;
    else if (order.order_category === 'VIP' || order.order_category === 'PHOTO') paidVIP += quantity;
    else if (order.order_category === 'OUTLET') paidOUTLET += quantity;
  });
  
  const salesData = {
    event_id: parseInt(eventId),
    sales_total_ga: paidGA > 0 ? paidGA : null,
    sales_total_vip: paidVIP > 0 ? paidVIP : null,
    sales_total_coatcheck: paidOUTLET > 0 ? paidOUTLET : null,
    sales_gross: totalGross > 0 ? totalGross : null,
    sales_net: totalNet > 0 ? totalNet : null
  };
  
  try {
    await supabase
      .from("events_sales")
      .upsert(salesData, { onConflict: "event_id" });
    console.log(`Sales summary: GA=${salesData.sales_total_ga}, VIP=${salesData.sales_total_vip}`);
  } catch (err) {
    console.error("Sales summary error:", err.message);
  }
}

// Update timestamp
async function updateEventTimestamp(eventId) {
  await supabase
    .from("events")
    .update({ event_order_updated: new Date().toISOString() })
    .eq("event_id", eventId);
}

// Process single event
async function processEvent(eventId) {
  console.log(`Processing event ${eventId}...`);
  
  const { data: event } = await supabase
    .from("events")
    .select("event_id, event_date, event_order_updated")
    .eq("event_id", eventId)
    .single();
    
  if (!event) {
    console.error(`Event ${eventId} not found`);
    return null;
  }
  
  // Check if processing needed
  let shouldProcess = false;
  let fromDate = null;
  
  if (!event.event_order_updated) {
    shouldProcess = true;
  } else {
    const eventDate = new Date(event.event_date);
    const dayAfter = new Date(eventDate);
    dayAfter.setDate(dayAfter.getDate() + 1);
    const lastUpdated = new Date(event.event_order_updated);
    
    if (lastUpdated < dayAfter) {
      shouldProcess = true;
      fromDate = event.event_order_updated;
    }
  }
  
  if (!shouldProcess) {
    console.log(`Event ${eventId}: Already up to date`);
    return { inserted: 0, skipped: 0 };
  }
  
  // Fetch and process orders
  const [orders, existingOrders] = await Promise.all([
    fetchOrders(eventId, fromDate),
    getExistingOrders(eventId)
  ]);
  
  if (!orders.length) {
    console.log(`Event ${eventId}: No orders found`);
    await updateEventTimestamp(eventId);
    return { inserted: 0, skipped: 0 };
  }
  
  const transformed = transformOrders(orders, eventId);
  const result = await insertOrders(transformed, existingOrders);
  
  await saveSalesSummary(eventId);
  await updateEventTimestamp(eventId);
  
  console.log(`Event ${eventId}: ${result.inserted} inserted, ${result.skipped} skipped`);
  return result;
}

// Get events that need updating
async function getEventsToUpdate() {
  const { data: events } = await supabase
    .from("events")
    .select("event_id, event_date, event_order_updated")
    .order("event_id");
    
  if (!events) return [];
  
  const toUpdate = [];
  
  for (const event of events) {
    if (!event.event_order_updated) {
      toUpdate.push(event.event_id);
    } else {
      const eventDate = new Date(event.event_date);
      const dayAfter = new Date(eventDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const lastUpdated = new Date(event.event_order_updated);
      
      if (lastUpdated < dayAfter) {
        toUpdate.push(event.event_id);
      }
    }
  }
  
  return toUpdate;
}

// Main execution
async function main() {
  const startTime = Date.now();
  
  try {
    console.log("Finding events that need updating...");
    const eventIds = await getEventsToUpdate();
    console.log(`Found ${eventIds.length} events to update`);
    
    if (eventIds.length === 0) {
      console.log("No events to process");
      return;
    }
    
    let totalInserted = 0;
    let totalSkipped = 0;
    let processed = 0;
    
    for (const eventId of eventIds) {
      const result = await processEvent(eventId);
      if (result) {
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        processed++;
      }
    }
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\nCompleted in ${duration.toFixed(1)}s`);
    console.log(`Events processed: ${processed}/${eventIds.length}`);
    console.log(`Orders inserted: ${totalInserted}`);
    console.log(`Orders skipped: ${totalSkipped}`);
    
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();