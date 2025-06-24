import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import crypto from 'crypto';

console.log('Event sync script starting...');

// Load environment variables for local development
if (process.env.NODE_ENV !== 'production') {
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch (error) {
    console.log('dotenv not available, using system environment variables');
  }
}

// Configure axios with timeout and connection pooling
axios.defaults.timeout = 15000; // Increased timeout for better reliability
axios.defaults.maxRedirects = 5;

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GROUP_ID = process.env.TIXR_GROUP_ID || '980';
const CPK = process.env.TIXR_CPK;
const SECRET_KEY = process.env.TIXR_SECRET_KEY;

// Validation
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CPK || !SECRET_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_KEY, TIXR_CPK, TIXR_SECRET_KEY');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Performance configuration
const CONCURRENCY_LIMIT = 10; // Process 10 events simultaneously
const BATCH_SIZE = 100; // Database batch size
const API_RETRY_ATTEMPTS = 3;

console.log('Configuration loaded:');
console.log('GROUP_ID:', GROUP_ID);
console.log('CPK:', CPK ? 'Set' : 'Missing');
console.log('SECRET_KEY:', SECRET_KEY ? 'Set' : 'Missing');
console.log('CONCURRENCY_LIMIT:', CONCURRENCY_LIMIT);

// Exclusion filter from manual-sync.js
const EXCLUDE_WORDS = [
  'TEST', 'TESTING', 'PASS', 'RÉSERVATIONS', 'RÉSERVATION', 'TEMPLATE'
];

// Artist extraction lists from refresh-event-artists.js
const EXCLUDE_LIST = [
  "moet city", "moët city", "le grand prix", "prix", "mutek", "édition",
  "évènement spécial", "room202", "produktworld", "admission", "taraka",
  "bazart", "city gas", "showcase", "special guest", "guests", "invité",
  "guest", "festival", "event", "experience", "produtk", "produkt",
  "soirée", "party", "post-race", "officiel", "after party", "ncg360",
  "visionnement", "montréal", "grand match", "off-piknic", "piknic",
  "ticket", "table", "official", "pass", "réveillon",
];
const INCLUDE_LIST = ["mimouna night", "dome of faith"];

// NEW: Function to check if event needs updating
function needsUpdate(eventDate, eventUpdated) {
  if (!eventUpdated) {
    // If no update timestamp, always update
    return true;
  }
  
  try {
    const eventDateObj = new Date(eventDate);
    const eventUpdatedObj = new Date(eventUpdated);
    
    // Add 1 day to event date
    const eventDatePlusOne = new Date(eventDateObj);
    eventDatePlusOne.setDate(eventDatePlusOne.getDate() + 1);
    
    // If event_updated is before event_date+1, update
    // If event_updated is after event_date+1, skip
    return eventUpdatedObj < eventDatePlusOne;
  } catch (error) {
    console.error('Error parsing dates for update check:', error);
    // If date parsing fails, update to be safe
    return true;
  }
}

// NEW: Function to get existing events from database for update checking
async function getExistingEventsForUpdateCheck() {
  try {
    console.log('📋 Fetching existing events from database for update check...');
    
    const { data: events, error } = await supabase
      .from('events')
      .select('event_id, event_date, event_updated');
    
    if (error) {
      console.error('Error fetching existing events:', error);
      return new Map(); // Return empty map to process all events
    }
    
    // Create a map for O(1) lookup
    const eventMap = new Map();
    events.forEach(event => {
      eventMap.set(event.event_id, {
        event_date: event.event_date,
        event_updated: event.event_updated
      });
    });
    
    console.log(`📋 Loaded ${events.length} existing events for update checking`);
    return eventMap;
    
  } catch (error) {
    console.error('Error in getExistingEventsForUpdateCheck:', error);
    return new Map(); // Return empty map to process all events
  }
}

// OPTIMIZED ARTIST NORMALIZATION AND FUZZY MATCHING
function normalizeArtistName(name) {
  if (!name || typeof name !== 'string') return '';
  
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]/g, '')
    .replace(/\bthe\b/g, '')
    .replace(/\b&\b/g, 'and')
    .replace(/\+/g, 'and')
    .trim();
}

function levenshteinDistance(str1, str2) {
  if (str1 === str2) return 0;
  
  // Quick length check optimization
  const lengthDiff = Math.abs(str1.length - str2.length);
  const maxLength = Math.max(str1.length, str2.length);
  if (lengthDiff > maxLength * 0.5) {
    return maxLength;
  }
  
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(0));
  
  // Initialize first row and column
  for (let i = 0; i <= str2.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= str1.length; j++) matrix[0][j] = j;
  
  // Fill matrix with optimized inner loop
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      const cost = str2[i - 1] === str1[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j - 1] + cost,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j] + 1
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

function calculateSimilarity(str1, str2) {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1;
  
  const distance = levenshteinDistance(str1, str2);
  return (maxLength - distance) / maxLength;
}

// ULTRA-OPTIMIZED ARTIST CACHE
let artistsCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache

async function getExistingArtists() {
  const now = Date.now();
  
  if (artistsCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return artistsCache;
  }
  
  try {
    console.log('🔄 Refreshing artist cache...');
    const { data: events, error } = await supabase
      .from('events')
      .select('event_artist')
      .not('event_artist', 'is', null);
    
    if (error) {
      console.error('Error fetching existing artists:', error);
      return { uniqueArtists: [], artistMap: new Map(), normalizedMap: new Map() };
    }
    
    const uniqueArtists = [...new Set(events.map(e => e.event_artist).filter(Boolean))];
    const artistMap = new Map();
    const normalizedMap = new Map();
    
    // Pre-compute all normalizations for O(1) lookup
    uniqueArtists.forEach(artist => {
      const normalized = normalizeArtistName(artist);
      artistMap.set(normalized, artist);
      normalizedMap.set(artist, normalized);
    });
    
    artistsCache = { uniqueArtists, artistMap, normalizedMap };
    cacheTimestamp = now;
    
    console.log(`✅ Artist cache updated: ${uniqueArtists.length} unique artists`);
    return artistsCache;
    
  } catch (error) {
    console.error('Error in getExistingArtists:', error);
    return { uniqueArtists: [], artistMap: new Map(), normalizedMap: new Map() };
  }
}

async function findSimilarArtist(newArtistName) {
  if (!newArtistName) return null;
  
  const { uniqueArtists, artistMap, normalizedMap } = await getExistingArtists();
  const normalized = normalizeArtistName(newArtistName);
  
  // STEP 1: Instant exact match (O(1))
  if (artistMap.has(normalized)) {
    const exactMatch = artistMap.get(normalized);
    return { match: exactMatch, similarity: 1.0, type: 'exact' };
  }
  
  // STEP 2: Optimized fuzzy matching with early termination
  const maxLengthDiff = Math.max(3, Math.floor(normalized.length * 0.2));
  let bestMatch = null;
  let bestSimilarity = 0;
  
  for (const artist of uniqueArtists) {
    const artistNormalized = normalizedMap.get(artist) || normalizeArtistName(artist);
    
    // Quick length filter
    if (Math.abs(normalized.length - artistNormalized.length) > maxLengthDiff) continue;
    
    const similarity = calculateSimilarity(normalized, artistNormalized);
    
    if (similarity > bestSimilarity && similarity >= 0.85) {
      bestMatch = artist;
      bestSimilarity = similarity;
      
      // Early termination for very high similarity
      if (similarity >= 0.95) break;
    }
  }
  
  if (bestMatch && bestSimilarity >= 0.85) {
    return { match: bestMatch, similarity: bestSimilarity, type: 'fuzzy' };
  }
  
  return null;
}

function shouldExclude(name) {
  if (!name) return true;
  return EXCLUDE_WORDS.some(word =>
    name.toUpperCase().includes(word.toUpperCase())
  );
}

// Utils from refresh-event-artists.js
function sanitizeName(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
}

function toTitleCase(name) {
  return name
    .split(/\s+/)
    .map((word) =>
      /^[A-Z]{2,}$/.test(word) || word === word.toUpperCase()
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ")
    .replace(
      /([A-Z])\-([A-Z]+)/g,
      (_, a, b) =>
        `${a}-${b.charAt(0).toUpperCase()}${b.slice(1).toLowerCase()}`
    );
}

// OPTIMIZED: Fetch ALL events with improved pagination and error handling
async function fetchAllTixrEvents() {
  console.log(`🔍 Fetching ALL events from Tixr group ${GROUP_ID}...`);
  
  const allEvents = [];
  let pageNumber = 1;
  let hasMorePages = true;
  let consecutiveEmptyPages = 0;
  
  while (hasMorePages && consecutiveEmptyPages < 2) {
    const basePath = `/v1/groups/${GROUP_ID}/events`;
    const t = Date.now();
    const params = {
      cpk: CPK,
      t,
      page_number: pageNumber,
      page_size: 1000, // OPTIMIZED: Increased from 100 to 1000
    };
    
    const { paramsSorted, hash } = buildHash(basePath, params);
    const url = `https://studio.tixr.com${basePath}?${paramsSorted}&hash=${hash}`;
    
    let retryCount = 0;
    let success = false;
    
    while (retryCount < API_RETRY_ATTEMPTS && !success) {
      try {
        console.log(`📄 Fetching page ${pageNumber}... (attempt ${retryCount + 1})`);
        const { data } = await axios.get(url);
        
        if (!Array.isArray(data)) {
          throw new Error('Invalid response format');
        }
        
        if (data.length === 0) {
          consecutiveEmptyPages++;
          console.log(`📄 Page ${pageNumber} is empty (${consecutiveEmptyPages}/2 empty pages)`);
        } else {
          consecutiveEmptyPages = 0;
          allEvents.push(...data);
          console.log(`📄 Page ${pageNumber}: ${data.length} events`);
        }
        
        if (data.length < 1000) {
          console.log(`📄 Page ${pageNumber} has ${data.length} events (less than 1000) - last page`);
          hasMorePages = false;
        } else {
          pageNumber++;
        }
        
        success = true;
        
      } catch (error) {
        retryCount++;
        console.error(`❌ Error fetching page ${pageNumber} (attempt ${retryCount}):`, error.message);
        
        if (retryCount < API_RETRY_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000); // Exponential backoff
          console.log(`🔄 Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`❌ Max retries reached for page ${pageNumber}, stopping`);
          hasMorePages = false;
        }
      }
    }
    
    // OPTIMIZED: Reduced delay between successful requests
    if (success && hasMorePages) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Reduced from 500ms to 100ms
    }
  }
  
  console.log(`📦 Total events fetched: ${allEvents.length}`);
  return allEvents;
}

// Build Tixr authentication hash
function buildHash(basePath, paramsObj) {
  const paramsSorted = Object.keys(paramsObj)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(paramsObj[k])}`)
    .join('&');
  const hashString = `${basePath}?${paramsSorted}`;
  const hash = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(hashString)
    .digest('hex');
  return { paramsSorted, hash };
}

// OPTIMIZED: Process events in parallel batches with update checking
async function syncAllEventsFromTixr() {
  console.log('🌍 ALL MODE: Syncing all events from Tixr group...');
  
  try {
    // Test Supabase connection
    console.log('Testing Supabase connection...');
    const { data: testData, error: testError } = await supabase
      .from('events')
      .select('count')
      .limit(1);
    
    if (testError) {
      console.error('Supabase connection failed:', testError);
      return;
    }
    console.log('✅ Supabase connection successful\n');
    
    // Pre-load artist cache and existing events for update checking
    await getExistingArtists();
    const existingEventsMap = await getExistingEventsForUpdateCheck();
    
    // Fetch all events from Tixr
    const allEvents = await fetchAllTixrEvents();
    
    if (allEvents.length === 0) {
      console.log('❌ No events found in Tixr group');
      return;
    }
    
    // Filter excluded events upfront
    const validEvents = allEvents.filter(event => !shouldExclude(event.name));
    const excludedCount = allEvents.length - validEvents.length;
    
    // NEW: Filter events that need updating
    const eventsToUpdate = [];
    const skippedCount = { total: 0, upToDate: 0 };
    
    console.log(`\n🔍 Checking which events need updating...`);
    
    for (const event of validEvents) {
      const eventId = parseInt(event.id);
      const eventDate = convertToMontrealDate(event.start_date);
      const existingEvent = existingEventsMap.get(eventId);
      
      if (existingEvent) {
        const needsUpdateResult = needsUpdate(eventDate, existingEvent.event_updated);
        
        if (needsUpdateResult) {
          eventsToUpdate.push(event);
        } else {
          skippedCount.total++;
          skippedCount.upToDate++;
          console.log(`⏭️  Skipping event ${eventId} - already up to date (updated after event_date+1)`);
        }
      } else {
        // New event, needs to be added
        eventsToUpdate.push(event);
      }
    }
    
    console.log(`\n📊 Update check summary:`);
    console.log(`   Total events fetched: ${allEvents.length}`);
    console.log(`   Valid events: ${validEvents.length}`);
    console.log(`   Events excluded (test/template): ${excludedCount}`);
    console.log(`   Events skipped (up to date): ${skippedCount.upToDate}`);
    console.log(`   Events to process: ${eventsToUpdate.length}`);
    
    if (eventsToUpdate.length === 0) {
      console.log('✅ All events are up to date! No processing needed.');
      return;
    }
    
    console.log(`\n🔄 Processing ${eventsToUpdate.length} events that need updating...`);
    
    let synced = 0;
    let failed = 0;
    const startTime = Date.now();
    
    // OPTIMIZED: Process events in parallel batches
    const eventBatches = [];
    for (let i = 0; i < eventsToUpdate.length; i += CONCURRENCY_LIMIT) {
      eventBatches.push(eventsToUpdate.slice(i, i + CONCURRENCY_LIMIT));
    }
    
    for (let batchIndex = 0; batchIndex < eventBatches.length; batchIndex++) {
      const batch = eventBatches[batchIndex];
      const batchStartTime = Date.now();
      
      console.log(`\n📦 Processing batch ${batchIndex + 1}/${eventBatches.length} (${batch.length} events)`);
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (tixrEvent, index) => {
          const globalIndex = batchIndex * CONCURRENCY_LIMIT + index;
          const progress = Math.floor(((globalIndex + 1) / eventsToUpdate.length) * 100);
          
          try {
            console.log(`[${progress}%] 🔄 Processing: "${tixrEvent.name}" (ID: ${tixrEvent.id})`);
            
            // Extract event data
            const eventDate = convertToMontrealDate(tixrEvent.start_date);
            const extractedArtist = extractArtistFromEvent(tixrEvent);
            const status = determineEventStatus(tixrEvent);
            const flyer = tixrEvent.flyer_url || (tixrEvent.media && tixrEvent.media[0]?.url) || null;
            
            // Artist duplicate detection
            let finalArtist = extractedArtist;
            if (extractedArtist) {
              const similarMatch = await findSimilarArtist(extractedArtist);
              if (similarMatch) {
                finalArtist = similarMatch.match;
                if (similarMatch.type === 'fuzzy') {
                  console.log(`   🔄 Using existing: "${similarMatch.match}" (${(similarMatch.similarity * 100).toFixed(1)}% similar)`);
                }
              }
            }
            
            // Prepare event data
            const eventData = {
              event_id: parseInt(tixrEvent.id),
              event_name: tixrEvent.name,
              event_date: eventDate,
              event_artist: finalArtist,
              event_status: status,
              event_genre: null,
              event_flyer: flyer,
              event_tags: null,
              event_updated: getCurrentTimestampWithTimezone()
            };
            
            return { success: true, data: eventData, progress };
            
          } catch (error) {
            console.log(`   ❌ Exception: ${error.message}`);
            return { success: false, error: error.message, event: tixrEvent, progress };
          }
        })
      );
      
      // Collect successful results for batch database operation
      const successfulEvents = [];
      const failedEvents = [];
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          successfulEvents.push(result.value.data);
          console.log(`   ✅ Prepared: ${result.value.data.event_artist || 'No artist'}`);
        } else {
          failed++;
          const error = result.status === 'rejected' ? result.reason : result.value.error;
          console.log(`   ❌ Failed: ${error}`);
          if (result.status === 'fulfilled') {
            failedEvents.push(result.value);
          }
        }
      });
      
      // OPTIMIZED: Batch database upsert
      if (successfulEvents.length > 0) {
        try {
          const { error } = await supabase
            .from('events')
            .upsert(successfulEvents, { onConflict: 'event_id' });
          
          if (error) {
            console.error(`❌ Batch upsert failed:`, error);
            failed += successfulEvents.length;
          } else {
            synced += successfulEvents.length;
            console.log(`✅ Batch ${batchIndex + 1}: ${successfulEvents.length} events synced`);
          }
        } catch (error) {
          console.error(`❌ Batch upsert exception:`, error);
          failed += successfulEvents.length;
        }
      }
      
      const batchTime = (Date.now() - batchStartTime) / 1000;
      console.log(`📊 Batch ${batchIndex + 1} completed in ${batchTime.toFixed(1)}s`);
      
      // Brief pause between batches to avoid overwhelming the API
      if (batchIndex < eventBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    
    console.log(`\n✅ Optimized bulk sync complete!`);
    console.log(`📊 Performance Summary:`);
    console.log(`   Total events fetched: ${allEvents.length}`);
    console.log(`   Events to process: ${eventsToUpdate.length}`);
    console.log(`   Events synced: ${synced}`);
    console.log(`   Events failed: ${failed}`);
    console.log(`   Events excluded: ${excludedCount}`);
    console.log(`   Events skipped (up to date): ${skippedCount.upToDate}`);
    console.log(`   Total time: ${totalTime.toFixed(1)}s`);
    console.log(`   Processing rate: ${(eventsToUpdate.length / totalTime).toFixed(1)} events/second`);
    console.log(`   Concurrency used: ${CONCURRENCY_LIMIT}`);
    
  } catch (error) {
    console.error('❌ Fatal error in syncAllEventsFromTixr:', error);
    throw error;
  }
}

async function fetchTixrEventById(eventId) {
  console.log(`Fetching TIXR event by ID: ${eventId}`);
  
  const t = Date.now().toString();
  const basePath = `/v1/groups/${GROUP_ID}/events/${eventId}?cpk=${encodeURIComponent(CPK)}&t=${encodeURIComponent(t)}`;
  const hash = crypto.createHmac('sha256', SECRET_KEY).update(basePath).digest('hex');
  const url = `https://studio.tixr.com${basePath}&hash=${hash}`;
  
  console.log('Making request to:', url);
  
  try {
    const { data } = await axios.get(url);
    console.log('Successfully fetched TIXR event');
    
    // Handle both single event and array responses
    if (Array.isArray(data)) {
      return data[0];
    }
    return data;
  } catch (error) {
    console.error('Error fetching TIXR event:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

function extractArtistFromEvent(tixrEvent) {
  // Try to extract artist from lineups first
  if (tixrEvent.lineups && tixrEvent.lineups.length > 0) {
    const lineup = tixrEvent.lineups[0];
    if (lineup.acts && lineup.acts.length > 0) {
      // Get the main act (usually rank 1 or first in array)
      const mainAct = lineup.acts.find(act => act.rank === 1) || lineup.acts[0];
      if (mainAct && mainAct.artist && mainAct.artist.name) {
        return mainAct.artist.name;
      }
    }
  }
  
  // Fallback: extract first artist name from event name using your exact method
  return extractMainArtist(tixrEvent.name);
}

// Extract only the main artist - your exact method from refresh-event-artists.js
function extractMainArtist(eventName, allArtistNames = []) {
  if (!eventName || typeof eventName !== "string") return null;
  let name = eventName.trim();

  // INCLUDE_LIST wins, even if EXCLUDE would match
  if (INCLUDE_LIST.some((w) => name.toLowerCase().includes(w))) {
    return toTitleCase(
      name
        .replace(/Takeover$/i, "")
        .replace(/Night$/i, "")
        .trim()
    );
  }

  // Remove leading "GPxx: " or "GPxx -"
  name = name.replace(/^gp\d+[:\-\s]*/i, "");
  name = name.replace(/^(.+?)\s+(présente|présentent|presents?)\s+.+$/i, "$1");
  const multipleArtistDelimiters = [", ", " + ", " b2b ", " & ", " x ", " / "];
  for (const delimiter of multipleArtistDelimiters) {
    if (name.includes(delimiter)) {
      name = name.split(delimiter)[0];
      break;
    }
  }
  name = name.replace(
    /\s+(et invités|and guests?|avec|feat\.?|featuring|b2b|vs|x|ft\.?)\s.*$/i,
    ""
  );
  name = name.replace(/ *[\(\[].*?[\)\]] */g, " ");
  name = name.split("|")[0].split("-")[0].split(":")[0].trim();
  if (/(\w+)'s\b/i.test(name)) name = name.match(/(\w+)'s\b/i)[1];
  name = name.replace(
    /\b(tour(nee)?|edition|montr[eé]al|takeover|night|crankdat|produktworld|ncg360|after party|officiel|post-race|off-piknic|off piknic|experience)\b.*$/i,
    ""
  );
  name = name.replace(/\d{4,}/g, "");
  name = name.replace(/[-–—|•:]+$/g, "");
  name = name.replace(/^[^a-z0-9]*|[^a-z0-9]*$/gi, "");

  let main = toTitleCase(sanitizeName(name).replace(/\s{2,}/g, " "));

  // Final fallback (as before)
  if (!main || !main.length) {
    const tryFirst = eventName
      .split(",")[0]
      .split("+")[0]
      .split("&")[0]
      .split("b2b")[0]
      .split("/")[0]
      .trim();
    if (tryFirst) main = toTitleCase(sanitizeName(tryFirst));
  }
  if (!main || !main.length) return null;

  // *** ONLY NOW, check if main matches any EXCLUDE word, as a full word ***
  const lowerMain = main.toLowerCase();
  const excludeRegex = new RegExp(`\\b(${EXCLUDE_LIST.join("|")})\\b`, "i");
  if (
    excludeRegex.test(lowerMain) &&
    !INCLUDE_LIST.some((w) => lowerMain.includes(w))
  )
    return null;
  // Normalize known suffixes or branding
  main = main
    .replace(/\b(\d{2,4}|live|tour|edition|set|experience)\b$/gi, "")
    .trim();

  return main;
}

function convertToMontrealDate(utcDateString) {
  // Convert UTC date to Montreal time (Eastern Time)
  const utcDate = new Date(utcDateString);
  
  // Convert to Montreal timezone and get the date in YYYY-MM-DD format
  const montrealDateString = utcDate.toLocaleDateString("en-CA", {
    timeZone: "America/Montreal",
    year: "numeric",
    month: "2-digit", 
    day: "2-digit"
  });
  
  return montrealDateString; // Already in YYYY-MM-DD format
}

function getCurrentTimestampWithTimezone() {
  // Return current timestamp with timezone info
  // This will show the timezone of where the script is run
  return new Date().toISOString();
}

function determineEventStatus(tixrEvent) {
  const now = new Date();
  const eventEndDate = new Date(tixrEvent.end_date || tixrEvent.start_date);
  
  // If event has ended, it's PAST, otherwise LIVE
  return eventEndDate < now ? 'PAST' : 'LIVE';
}

async function syncEventToSupabase(eventId) {
  console.log(`Starting sync for event ID: ${eventId}`);
  
  try {
    // Test Supabase connection
    console.log('Testing Supabase connection...');
    const { data: testData, error: testError } = await supabase
      .from('events')
      .select('count')
      .limit(1);
    
    if (testError) {
      console.error('Supabase connection failed:', testError);
      return;
    }
    console.log('Supabase connection successful');

    // NEW: Check if single event needs updating
    console.log('🔍 Checking if event needs updating...');
    const { data: existingEvent, error: checkError } = await supabase
      .from('events')
      .select('event_date, event_updated')
      .eq('event_id', parseInt(eventId))
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking existing event:', checkError);
      // Continue with sync if error checking
    }

    // Fetch event from Tixr
    const tixrEvent = await fetchTixrEventById(eventId);
    
    if (!tixrEvent) {
      console.error(`Event ${eventId} not found in Tixr`);
      return;
    }
    
    // Check if event should be excluded
    if (shouldExclude(tixrEvent.name)) {
      console.log(`❌ Skipping event "${tixrEvent.name}" - contains excluded words`);
      return;
    }
    
    // NEW: Check if event needs updating (only for existing events)
    if (existingEvent) {
      const eventDate = convertToMontrealDate(tixrEvent.start_date);
      const needsUpdateResult = needsUpdate(eventDate, existingEvent.event_updated);
      
      if (!needsUpdateResult) {
        console.log(`⏭️  Event ${eventId} is already up to date (updated after event_date+1)`);
        console.log(`   Event date: ${eventDate}`);
        console.log(`   Last updated: ${existingEvent.event_updated}`);
        console.log('✅ No sync needed');
        return;
      } else {
        console.log(`🔄 Event ${eventId} needs updating`);
        console.log(`   Event date: ${eventDate}`);
        console.log(`   Last updated: ${existingEvent.event_updated || 'Never'}`);
      }
    } else {
      console.log(`✨ New event ${eventId} - will be added to database`);
    }
    
    console.log(`Processing event: "${tixrEvent.name}"`);
    
    // Extract event data - convert to Montreal time (Eastern Time)
    const eventDate = convertToMontrealDate(tixrEvent.start_date);
    const extractedArtist = extractArtistFromEvent(tixrEvent);
    const status = determineEventStatus(tixrEvent);
    const flyer = tixrEvent.flyer_url || (tixrEvent.media && tixrEvent.media[0]?.url) || null;
    
    // ARTIST DUPLICATE DETECTION AND NORMALIZATION
    let finalArtist = extractedArtist;
    
    if (extractedArtist) {
      console.log(`🎵 Extracted artist: "${extractedArtist}"`);
      
      const similarMatch = await findSimilarArtist(extractedArtist);
      
      if (similarMatch) {
        if (similarMatch.type === 'exact') {
          console.log(`🔄 Using existing artist name: "${similarMatch.match}"`);
          finalArtist = similarMatch.match;
        } else if (similarMatch.type === 'fuzzy') {
          console.log(`⚠️  Potential duplicate detected:`);
          console.log(`   New: "${extractedArtist}"`);
          console.log(`   Existing: "${similarMatch.match}" (${(similarMatch.similarity * 100).toFixed(1)}% similar)`);
          console.log(`🔄 Using existing artist name to maintain consistency`);
          finalArtist = similarMatch.match;
        }
      } else {
        console.log(`✨ New unique artist: "${extractedArtist}"`);
      }
    }
    
    // Prepare event data for database
    const eventData = {
      event_id: parseInt(tixrEvent.id),
      event_name: tixrEvent.name,
      event_date: eventDate,
      event_artist: finalArtist,
      event_status: status,
      event_genre: null, // Will be set by another script
      event_flyer: flyer,
      event_tags: null, // Will be set by another script
      event_updated: getCurrentTimestampWithTimezone()
    };
    
    console.log('Event data to insert:', eventData);
    
    // Insert/update event in Supabase
    const { data, error } = await supabase
      .from('events')
      .upsert(eventData, {
        onConflict: 'event_id'
      })
      .select();
    
    if (error) {
      console.error('Error upserting event:', error);
      return;
    }
    
    console.log('✅ Successfully synced event to Supabase');
    console.log('Inserted/Updated data:', data);
    
  } catch (error) {
    console.error('Fatal error in syncEventToSupabase:', error);
    throw error;
  }
}

// Main execution
async function main() {
  const eventId = process.argv[2];
  
  if (!eventId) {
    console.error('❌ Please provide an event ID as an argument, or use "all" to sync all events');
    console.log('Usage: node event-sync.js <event_id|all>');
    console.log('Examples:');
    console.log('  node event-sync.js 47313        # Sync single event');
    console.log('  node event-sync.js all          # Sync ALL events from Tixr group');
    process.exit(1);
  }
  
  if (eventId === 'all') {
    console.log(`🚀 Starting OPTIMIZED bulk sync for ALL events in Tixr group ${GROUP_ID}...`);
    console.log(`⚡ Performance settings: ${CONCURRENCY_LIMIT} concurrent events, ${BATCH_SIZE} batch size`);
    console.log(`🔍 Update logic: Only process events where event_updated < event_date+1`);
    
    try {
      const startTime = Date.now();
      await syncAllEventsFromTixr();
      const totalTime = (Date.now() - startTime) / 1000;
      console.log(`\n🎯 OPTIMIZATION SUCCESS! Total time: ${totalTime.toFixed(1)}s`);
      console.log('✅ Optimized bulk sync completed successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Bulk sync failed:', error);
      process.exit(1);
    }
  } else {
    console.log(`🚀 Starting sync for event ID: ${eventId}`);
    console.log(`🔍 Update logic: Check if event_updated < event_date+1 before processing`);
    
    try {
      await syncEventToSupabase(eventId);
      console.log('✅ Script completed successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Script failed:', error);
      process.exit(1);
    }
  }
}

main();