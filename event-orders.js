import axios from "axios";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// Load environment variables for local development
if (process.env.NODE_ENV !== 'production') {
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch (error) {
    console.log('dotenv not available, using system environment variables');
  }
}

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY; 
const GROUP_ID = process.env.TIXR_GROUP_ID || '980';
const CPK = process.env.TIXR_CPK;
const SECRET_KEY = process.env.TIXR_SECRET_KEY;

// Validation
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CPK || !SECRET_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_KEY, TIXR_CPK, TIXR_SECRET_KEY');
  process.exit(1);
}

// Axios configuration for speed
axios.defaults.timeout = 8000;
axios.defaults.maxRedirects = 2;

// Supabase client (simplified - remove problematic options)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const force = args.includes('force');
const debug = args.includes('debug');

// Validate input
if (!command || (command !== 'update' && !command.match(/^\d+(,\d+)*$/))) {
  console.error("Usage:");
  console.error("  node event-orders.js <EVENT_ID>           # Single event");
  console.error("  node event-orders.js <ID,ID,ID>           # Multiple events");
  console.error("  node event-orders.js update               # All eligible events");
  console.error("  node event-orders.js <EVENT_ID> force     # Force update");
  console.error("  node event-orders.js <ID,ID,ID> force     # Force update multiple");
  console.error("  node event-orders.js <EVENT_ID> debug     # Debug mode for single event");
  process.exit(1);
}

// Performance tracking
const metrics = {
  startTime: Date.now(),
  eventsProcessed: 0,
  ordersInserted: 0,
  ordersSkipped: 0,
  usersCreated: 0,
  usersUpdated: 0
};

// Build Tixr authentication hash
function buildHash(basePath, params) {
  const sorted = Object.keys(params)
    .sort()
    .map(k => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  
  const hash = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(`${basePath}?${sorted}`)
    .digest("hex");
    
  return { sorted, hash };
}

// Fetch orders from Tixr API with aggressive parallel fetching
async function fetchOrders(eventId, fromDate = null) {
  const startDate = fromDate ? new Date(fromDate).toISOString().split('T')[0] : "2020-01-01";
  
  // Fetch first page to determine scale
  const firstPage = await fetchSinglePage(eventId, 1, startDate);
  if (!firstPage || firstPage.length === 0) {
    return [];
  }
  
  const orders = [...firstPage];
  
  // If first page is full, aggressively fetch multiple pages in parallel
  if (firstPage.length === 1000) {
    // Start with 10 parallel pages immediately
    const parallelPages = Array.from({ length: 10 }, (_, i) => 
      fetchSinglePage(eventId, i + 2, startDate)
    );
    
    const results = await Promise.allSettled(parallelPages);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
        orders.push(...result.value);
      }
    }
  }
  
  // Filter to complete orders and apply date filter
  const completeOrders = orders.filter(order => order.status === "COMPLETE");
  
  if (fromDate) {
    const fromMs = new Date(fromDate).getTime();
    return completeOrders.filter(order => {
      const purchaseMs = parseInt(order.purchase_date);
      return purchaseMs >= fromMs;
    });
  }
  
  return completeOrders;
}

// Helper function to fetch a single page (faster timeout)
async function fetchSinglePage(eventId, page, startDate) {
  const basePath = `/v1/groups/${GROUP_ID}/events/${eventId}/orders`;
  const params = {
    cpk: CPK,
    t: Date.now(),
    page_number: page,
    page_size: 1000,
    start_date: startDate
  };
  
  const { sorted, hash } = buildHash(basePath, params);
  const url = `https://studio.tixr.com${basePath}?${sorted}&hash=${hash}`;
  
  try {
    const response = await axios.get(url, { timeout: 6000 });
    return response.data || [];
  } catch (error) {
    return []; // Fail silently for speed
  }
}

// Format names to proper case
function formatName(name) {
  if (!name || typeof name !== "string") return null;

  return name
    .trim()
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (word.length === 0) return "";
      if (word.includes("-")) {
        return word
          .split("-")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("-");
      }
      if (word.includes("'")) {
        return word
          .split("'")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("'");
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

// Process users from orders (fixed to handle existing users)
async function processUsers(orders, eventId) {
  if (!orders.length) return;
  
  // Filter out @produkt.ca emails and get unique users
  const eligibleOrders = orders.filter(order => {
    if (!order.user_id) return false;
    if (order.email && order.email.toLowerCase().includes("@produkt.ca")) {
      return false;
    }
    return true;
  });
  
  const uniqueUserIds = [...new Set(eligibleOrders.map(order => order.user_id))];
  
  if (!uniqueUserIds.length) {
    console.log("No eligible users found");
    return;
  }
  
  // Check existing users
  const { data: existingUsers } = await supabase
    .from("events_users")
    .select("user_id, event_ids")
    .in("user_id", uniqueUserIds);
    
  const existingUserMap = new Map();
  if (existingUsers) {
    existingUsers.forEach(user => {
      existingUserMap.set(user.user_id, user.event_ids || []);
    });
  }
  
  // Determine users to create vs update
  const usersToCreate = [];
  const usersToUpdate = [];
  
  for (const userId of uniqueUserIds) {
    if (existingUserMap.has(userId)) {
      const currentEvents = existingUserMap.get(userId);
      if (!currentEvents.includes(parseInt(eventId))) {
        usersToUpdate.push({
          user_id: userId,
          event_ids: [...currentEvents, parseInt(eventId)]
        });
      }
    } else {
      const userOrder = eligibleOrders.find(order => order.user_id === userId);
      if (userOrder) {
        usersToCreate.push({
          user_id: userId,
          event_ids: [parseInt(eventId)],
          user_first_name: formatName(userOrder.first_name),
          user_last_name: formatName(userOrder.lastname),
          user_mail: userOrder.email || null,
          user_birth_date: userOrder.birth_date || null,
          user_city: userOrder.geo_info?.city || null,
          user_state: userOrder.geo_info?.state || null,
          user_country: userOrder.geo_info?.country_code || null,
          user_postal: userOrder.geo_info?.postal_code || null
        });
      }
    }
  }
  
  // Create new users
  if (usersToCreate.length > 0) {
    console.log(`Creating ${usersToCreate.length} new users...`);
    
    const batchSize = 500;
    const batches = [];
    
    for (let i = 0; i < usersToCreate.length; i += batchSize) {
      batches.push(usersToCreate.slice(i, i + batchSize));
    }
    
    const operations = batches.map(batch => 
      supabase
        .from("events_users")
        .insert(batch, { ignoreDuplicates: true })
        .then(() => metrics.usersCreated += batch.length)
        .catch(() => {})
    );
    
    await Promise.allSettled(operations);
  }
  
  // Update existing users
  if (usersToUpdate.length > 0) {
    console.log(`Updating ${usersToUpdate.length} existing users...`);
    
    for (const user of usersToUpdate) {
      await supabase
        .from("events_users")
        .update({ event_ids: user.event_ids })
        .eq("user_id", user.user_id)
        .then(() => metrics.usersUpdated++)
        .catch(() => {});
    }
  }
  
  const totalProcessed = usersToCreate.length + usersToUpdate.length;
  if (totalProcessed > 0) {
    console.log(`User processing: ${usersToCreate.length} created, ${usersToUpdate.length} updated`);
  }
}

// Transform orders for database
function transformOrders(orders, eventId) {
  const transformed = [];
  
  for (const order of orders) {
    if (!order.sale_items?.length) continue;
    
    for (const item of order.sale_items) {
      // Extract serial numbers
      let serials = null;
      if (item.tickets?.length) {
        const serialNumbers = item.tickets
          .map(t => t.serial_number)
          .filter(s => s && s.trim());
        if (serialNumbers.length > 0) {
          serials = JSON.stringify(serialNumbers);
        }
      }
      
      // Use Tixr API item-level pricing
      // Each sale_item has its own 'total' and 'net' values
      let itemGross = item.total || null;  // Use item's 'total' as gross
      let itemNet = item.net || null;      // Use item's 'net' as net
      
      // If item values are 0, keep them as 0 (not null)
      if (itemGross === 0) itemGross = 0;
      if (itemNet === 0) itemNet = 0;
      
      transformed.push({
        event_id: parseInt(eventId),
        order_sale_id: item.sale_id || null,
        order_tier_id: item.tier_id || null,
        order_category: item.category || null,
        order_quantity: item.quantity || null,
        order_sales_item_name: item.name || null,
        order_serials: serials,
        order_name: order.order_id || null,
        order_gross: itemGross,
        order_net: itemNet,
        order_purchase_date: order.purchase_date ? new Date(parseInt(order.purchase_date)).toISOString() : null,
        order_user_id: order.user_id || null,
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

// Check existing orders
async function getExistingOrders(eventId) {
  const { data } = await supabase
    .from("events_orders")
    .select("order_name, order_sale_id")
    .eq("event_id", eventId);
    
  const existing = new Set();
  if (data) {
    data.forEach(order => {
      const key = `${order.order_name || "null"}_${order.order_sale_id || "null"}`;
      existing.add(key);
    });
  }
  
  return existing;
}

// Insert orders to database (back to simple insert)
async function insertOrders(orders, existingOrders) {
  if (!orders.length) return { inserted: 0, skipped: 0 };
  
  // Filter out existing orders unless force mode
  const toInsert = force ? orders : orders.filter(order => {
    const key = `${order.order_name || "null"}_${order.order_sale_id || "null"}`;
    return !existingOrders.has(key);
  });
  
  if (!toInsert.length) {
    return { inserted: 0, skipped: orders.length };
  }
  
  // Use regular insert
  const ordersToInsert = toInsert.map(order => ({
    ...order,
    order_user_id: null // Skip user validation for maximum speed
  }));
  
  // Insert in batches
  let inserted = 0;
  const batchSize = 1000;
  
  const batches = [];
  for (let i = 0; i < ordersToInsert.length; i += batchSize) {
    batches.push(ordersToInsert.slice(i, i + batchSize));
  }
  
  // Process batches
  const operations = batches.map(batch => 
    supabase
      .from("events_orders")
      .insert(batch)
      .then(() => inserted += batch.length)
      .catch(error => {
        console.error("Insert error:", error.message);
      })
  );
  
  await Promise.allSettled(operations);
  
  return {
    inserted,
    skipped: orders.length - ordersToInsert.length
  };
}

// Save sales summary by reading from database (after orders are inserted)
async function saveSalesSummary(eventId) {
  // Read ALL orders for this event from the database (remove default limit)
  let allOrders = [];
  let from = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data: orderBatch, error } = await supabase
      .from("events_orders")
      .select("*")
      .eq("event_id", eventId)
      .range(from, from + batchSize - 1);
      
    if (error) {
      console.error("Error reading orders from database:", error);
      return;
    }
    
    if (!orderBatch || orderBatch.length === 0) {
      break;
    }
    
    allOrders.push(...orderBatch);
    
    if (orderBatch.length < batchSize) {
      break; // This was the last batch
    }
    
    from += batchSize;
  }
  
  // Split orders into paid and free based on actual revenue
  const paidOrders = allOrders.filter(order => 
    (order.order_gross && order.order_gross > 0) || 
    (order.order_net && order.order_net > 0)
  );
  
  const freeOrders = allOrders.filter(order => 
    (!order.order_gross || order.order_gross === 0) && 
    (!order.order_net || order.order_net === 0)
  );
  
  // Calculate PAID totals - count ALL paid tickets by category (including PHOTO as VIP)
  let paidGA = 0;
  let paidVIP = 0;
  let paidOUTLET = 0;
  let totalGross = 0;
  let totalNet = 0;
  
  if (debug) {
    console.log(`\n🔍 DEBUG: Analyzing ${paidOrders.length} paid orders:`);
  }
  
  paidOrders.forEach(order => {
    const quantity = order.order_quantity || 1;
    
    if (order.order_gross) totalGross += order.order_gross;
    if (order.order_net) totalNet += order.order_net;
    
    // Count ALL paid tickets by category (not just specific names)
    if (order.order_category === 'GA') {
      paidGA += quantity;
      if (debug) {
        console.log(`  ✅ GA: ${quantity}x "${order.order_sales_item_name}" (${order.order_gross})`);
      }
    } else if (order.order_category === 'VIP' || order.order_category === 'PHOTO') {
      paidVIP += quantity;
      if (debug) {
        console.log(`  ✅ VIP/PHOTO: ${quantity}x "${order.order_sales_item_name}" (${order.order_gross}) [${order.order_category}]`);
      }
    } else if (order.order_category === 'OUTLET') {
      paidOUTLET += quantity;
      if (debug) {
        console.log(`  ✅ OUTLET: ${quantity}x "${order.order_sales_item_name}" (${order.order_gross})`);
      }
    } else if (debug) {
      console.log(`  ❓ OTHER: ${quantity}x "${order.order_sales_item_name}" (${order.order_gross}) [${order.order_category}]`);
    }
  });
  
  if (debug) {
    console.log(`\n🔍 DEBUG: Analyzing ${freeOrders.length} free orders:`);
    
    // Debug free orders breakdown
    let debugFreeGA = 0;
    let debugFreeVIP = 0;
    let debugCompGA = 0;
    let debugCompVIP = 0;
    let debugBackstage = 0;
    let debugExcluded = 0;
    let debugOther = 0;
    
    freeOrders.forEach(order => {
      const quantity = order.order_quantity || 1;
      const itemName = order.order_sales_item_name?.toLowerCase() || "";
      
      if (order.order_ref_type === 'BACKSTAGE') {
        if (itemName.includes('comp')) {
          if (order.order_category === 'VIP' || order.order_category === 'PHOTO' || 
              itemName.includes('vip') || itemName.includes('side stage')) {
            debugCompVIP += quantity;
            console.log(`  🎫 COMP VIP: ${quantity}x "${order.order_sales_item_name}" [${order.order_category}]`);
          } else {
            debugCompGA += quantity;
            console.log(`  🎫 COMP GA: ${quantity}x "${order.order_sales_item_name}" [${order.order_category}]`);
          }
        } else {
          debugBackstage += quantity;
          console.log(`  🚪 BACKSTAGE: ${quantity}x "${order.order_sales_item_name}" [${order.order_category}]`);
        }
      } else if (itemName.includes('comp') || itemName.includes('billet physique') || itemName.includes('door')) {
        debugExcluded += quantity;
        console.log(`  ❌ EXCLUDED: ${quantity}x "${order.order_sales_item_name}" [${order.order_category}]`);
      } else if (order.order_category === 'GA') {
        debugFreeGA += quantity;
        console.log(`  🆓 FREE GA: ${quantity}x "${order.order_sales_item_name}"`);
      } else if (order.order_category === 'VIP' || order.order_category === 'PHOTO') {
        debugFreeVIP += quantity;
        console.log(`  🆓 FREE VIP: ${quantity}x "${order.order_sales_item_name}" [${order.order_category}]`);
      } else if (order.order_category === 'GUEST') {
        if (itemName.includes('vip') || itemName.includes('side stage')) {
          debugFreeVIP += quantity;
          console.log(`  🆓 FREE VIP (GUEST): ${quantity}x "${order.order_sales_item_name}"`);
        } else {
          debugFreeGA += quantity;
          console.log(`  🆓 FREE GA (GUEST): ${quantity}x "${order.order_sales_item_name}"`);
        }
      } else {
        debugOther += quantity;
        console.log(`  ❓ OTHER FREE: ${quantity}x "${order.order_sales_item_name}" [${order.order_category}]`);
      }
    });
    
    console.log(`\n📊 DEBUG SUMMARY:`);
    console.log(`  Paid GA: ${paidGA}`);
    console.log(`  Paid VIP/PHOTO: ${paidVIP}`);
    console.log(`  Paid OUTLET: ${paidOUTLET}`);
    console.log(`  Comp GA: ${debugCompGA}`);
    console.log(`  Comp VIP: ${debugCompVIP}`);
    console.log(`  Free GA: ${debugFreeGA}`);
    console.log(`  Free VIP: ${debugFreeVIP}`);
    console.log(`  Backstage non-comp: ${debugBackstage}`);
    console.log(`  Excluded: ${debugExcluded}`);
    console.log(`  Other: ${debugOther}`);
  }
  
  // Calculate COMP tickets
  let compGA = 0;
  let compVIP = 0;
  
  freeOrders.forEach(order => {
    if (order.order_ref_type === 'BACKSTAGE' && 
        order.order_sales_item_name && 
        order.order_sales_item_name.toLowerCase().includes('comp')) {
      
      const quantity = order.order_quantity || 1;
      const itemName = order.order_sales_item_name.toLowerCase();
      const category = order.order_category;
      
      // Check for VIP indicators first (including PHOTO category)
      if (category === 'VIP' || category === 'PHOTO' ||
          itemName.includes('vip') || 
          itemName.includes('side stage')) {
        compVIP += quantity;
      }
      // Check for GA indicators
      else if (category === 'GA' || category === 'GUEST') {
        compGA += quantity;
      }
    }
  });
  
  // Calculate FREE tickets
  let freeGA = 0;
  let freeVIP = 0;
  
  freeOrders.forEach(order => {
    if (order.order_ref_type !== 'BACKSTAGE' &&
        order.order_sales_item_name) {
      
      const itemName = order.order_sales_item_name.toLowerCase();
      const quantity = order.order_quantity || 1;
      
      // Skip excluded items
      if (itemName.includes('comp') || 
          itemName.includes('billet physique') || 
          itemName.includes('door')) {
        return;
      }
      
      // Count free tickets (including PHOTO as VIP)
      if (order.order_category === 'GA') {
        freeGA += quantity;
      } else if (order.order_category === 'VIP' || order.order_category === 'PHOTO') {
        freeVIP += quantity;
      } else if (order.order_category === 'GUEST') {
        if (itemName.includes('vip') || itemName.includes('side stage')) {
          freeVIP += quantity;
        } else {
          freeGA += quantity;
        }
      }
    }
  });
  
  const salesData = {
    event_id: parseInt(eventId),
    sales_total_ga: paidGA > 0 ? paidGA : null,
    sales_total_vip: paidVIP > 0 ? paidVIP : null,
    sales_total_coatcheck: paidOUTLET > 0 ? paidOUTLET : null,
    sales_total_comp_ga: compGA > 0 ? compGA : null,
    sales_total_comp_vip: compVIP > 0 ? compVIP : null,
    sales_total_free_ga: freeGA > 0 ? freeGA : null,
    sales_total_free_vip: freeVIP > 0 ? freeVIP : null,
    sales_gross: totalGross > 0 ? totalGross : null,
    sales_net: totalNet > 0 ? totalNet : null
  };
  
  try {
    const { error } = await supabase
      .from("events_sales")
      .upsert(salesData, { onConflict: "event_id" });
      
    if (error) {
      console.error("Sales summary error:", error);
    } else {
      console.log(`Sales summary: GA=${salesData.sales_total_ga}, VIP=${salesData.sales_total_vip}, CompGA=${salesData.sales_total_comp_ga}, CompVIP=${salesData.sales_total_comp_vip}, FreeGA=${salesData.sales_total_free_ga}, FreeVIP=${salesData.sales_total_free_vip}`);
    }
  } catch (err) {
    console.error("Sales summary exception:", err.message);
  }
}

// Update event timestamp
async function updateEventTimestamp(eventId) {
  await supabase
    .from("events")
    .update({ event_order_updated: new Date().toISOString() })
    .eq("event_id", eventId);
}

// Process single event (clean output)
async function processEvent(eventId) {
  console.log(`Processing event ${eventId}...`);
  
  // Get event info
  const { data: event } = await supabase
    .from("events")
    .select("event_id, event_name, event_date, event_order_updated")
    .eq("event_id", eventId)
    .single();
    
  if (!event) {
    console.error(`Event ${eventId} not found`);
    return null;
  }
  
  // If force mode, delete existing orders first
  if (force) {
    console.log(`Force mode: Deleting existing orders...`);
    const { error: deleteError } = await supabase
      .from("events_orders")
      .delete()
      .eq("event_id", eventId);
      
    if (deleteError) {
      console.error("Error deleting existing orders:", deleteError);
    }
  }
  
  // Determine if processing is needed
  let shouldProcess = force;
  let fromDate = null;
  
  if (!force) {
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
  }
  
  if (!shouldProcess) {
    console.log(`Event ${eventId}: Already up to date`);
    return { inserted: 0, skipped: 0, processed: false };
  }
  
  // Fetch orders and existing orders
  const [orders, existingOrders] = await Promise.all([
    fetchOrders(eventId, fromDate),
    force ? Promise.resolve(new Set()) : getExistingOrders(eventId)
  ]);
  
  if (!orders.length) {
    console.log(`Event ${eventId}: No orders found`);
    await updateEventTimestamp(eventId);
    return { inserted: 0, skipped: 0, processed: true };
  }
  
  // Transform orders
  const transformed = transformOrders(orders, eventId);
  
  // 1. Insert orders to database
  const orderResult = await insertOrders(transformed, existingOrders);
  
  // 2. Process users (fire and forget)
  processUsers(orders, eventId).catch(() => {});
  
  // 3. Calculate sales summary from database
  await saveSalesSummary(eventId);
  
  // 4. Update timestamp
  await updateEventTimestamp(eventId);
  
  console.log(`Event ${eventId}: ${orderResult.inserted} inserted, ${orderResult.skipped} skipped`);
  
  return { ...orderResult, processed: true };
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
    let eventIds = [];
    
    if (command === 'update') {
      console.log("Finding events that need updating...");
      eventIds = await getEventsToUpdate();
      console.log(`Found ${eventIds.length} events to update`);
    } else {
      eventIds = command.split(',').map(id => parseInt(id.trim()));
    }
    
    if (eventIds.length === 0) {
      console.log("No events to process");
      return;
    }
    
    // Process events
    let totalInserted = 0;
    let totalSkipped = 0;
    let processed = 0;
    
    for (const eventId of eventIds) {
      const result = await processEvent(eventId);
      if (result) {
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        if (result.processed) processed++;
      }
    }
    
    // Summary
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\nCompleted in ${duration.toFixed(1)}s`);
    console.log(`Events processed: ${processed}/${eventIds.length}`);
    console.log(`Orders inserted: ${totalInserted}`);
    console.log(`Orders skipped: ${totalSkipped}`);
    console.log(`Users created: ${metrics.usersCreated}`);
    console.log(`Users updated: ${metrics.usersUpdated}`);
    
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();