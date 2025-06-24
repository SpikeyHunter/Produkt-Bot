// scripts/tixr.js - Tixr API integration
const axios = require('axios');
const crypto = require('crypto');

class TixrAPI {
  constructor() {
    this.baseURL = 'https://studio.tixr.com';
    this.groupId = process.env.TIXR_GROUP_ID || '980';
    this.cpk = process.env.TIXR_CPK;
    this.secretKey = process.env.TIXR_SECRET_KEY;
    
    if (!this.cpk || !this.secretKey) {
      console.warn('⚠️ Tixr API credentials not found in environment variables');
    }
  }

  /**
   * Build authentication hash for Tixr API
   */
  buildHash(basePath, params) {
    const sorted = Object.keys(params)
      .sort()
      .map(k => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');
    
    const hash = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${basePath}?${sorted}`)
      .digest('hex');
      
    return { sorted, hash };
  }

  /**
   * Get upcoming events
   */
  async getUpcomingEvents(limit = 5) {
    try {
      const basePath = `/v1/groups/${this.groupId}/events`;
      const params = {
        cpk: this.cpk,
        t: Date.now(),
        page_number: 1,
        page_size: limit
      };

      const { sorted, hash } = this.buildHash(basePath, params);
      const url = `${this.baseURL}${basePath}?${sorted}&hash=${hash}`;

      const response = await axios.get(url, { timeout: 10000 });
      
      if (!Array.isArray(response.data)) {
        throw new Error('Invalid response format from Tixr API');
      }

      // Filter to upcoming events only
      const today = new Date();
      const upcomingEvents = response.data.filter(event => {
        const eventDate = new Date(event.start_date);
        return eventDate >= today;
      });

      return { 
        success: true, 
        events: upcomingEvents.slice(0, limit),
        total: upcomingEvents.length 
      };

    } catch (error) {
      console.error('Tixr API error (getUpcomingEvents):', error.message);
      return { 
        success: false, 
        error: error.message,
        events: []
      };
    }
  }

  /**
   * Get event by ID
   */
  async getEventById(eventId) {
    try {
      const basePath = `/v1/groups/${this.groupId}/events/${eventId}`;
      const params = {
        cpk: this.cpk,
        t: Date.now()
      };

      const { sorted, hash } = this.buildHash(basePath, params);
      const url = `${this.baseURL}${basePath}?${sorted}&hash=${hash}`;

      const response = await axios.get(url, { timeout: 10000 });
      
      return { 
        success: true, 
        event: Array.isArray(response.data) ? response.data[0] : response.data 
      };

    } catch (error) {
      console.error(`Tixr API error (getEventById ${eventId}):`, error.message);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get sales data for an event
   */
  async getEventSales(eventId, startDate = null) {
    try {
      const basePath = `/v1/groups/${this.groupId}/events/${eventId}/orders`;
      const params = {
        cpk: this.cpk,
        t: Date.now(),
        page_number: 1,
        page_size: 1000
      };

      if (startDate) {
        params.start_date = startDate;
      }

      const { sorted, hash } = this.buildHash(basePath, params);
      const url = `${this.baseURL}${basePath}?${sorted}&hash=${hash}`;

      const response = await axios.get(url, { timeout: 15000 });
      
      if (!Array.isArray(response.data)) {
        throw new Error('Invalid sales response format from Tixr API');
      }

      // Process and aggregate sales data
      const orders = response.data.filter(order => order.status === "COMPLETE");
      const salesSummary = this.processSalesData(orders);

      return { 
        success: true, 
        orders,
        summary: salesSummary
      };

    } catch (error) {
      console.error(`Tixr API error (getEventSales ${eventId}):`, error.message);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Process sales data into summary
   */
  processSalesData(orders) {
    const summary = {
      totalOrders: orders.length,
      totalRevenue: 0,
      ticketTypes: {},
      totalTickets: 0
    };

    orders.forEach(order => {
      if (order.sale_items && Array.isArray(order.sale_items)) {
        order.sale_items.forEach(item => {
          // Add to revenue
          if (item.total) {
            summary.totalRevenue += parseFloat(item.total);
          }

          // Count ticket types
          const category = item.category || 'Unknown';
          if (!summary.ticketTypes[category]) {
            summary.ticketTypes[category] = {
              count: 0,
              revenue: 0
            };
          }
          
          summary.ticketTypes[category].count += item.quantity || 1;
          summary.ticketTypes[category].revenue += parseFloat(item.total || 0);
          summary.totalTickets += item.quantity || 1;
        });
      }
    });

    return summary;
  }

  /**
   * Format event data for display
   */
  formatEventData(event) {
    if (!event) return null;

    const eventDate = new Date(event.start_date);
    const formattedDate = eventDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return {
      id: event.id,
      name: event.name,
      date: formattedDate,
      rawDate: event.start_date,
      venue: event.venue_name || 'TBA',
      flyer: event.flyer_url || event.media?.[0]?.url || null
    };
  }

  /**
   * Test Tixr API connection
   */
  async testConnection() {
    try {
      const result = await this.getUpcomingEvents(1);
      if (result.success) {
        return { 
          success: true, 
          message: 'Tixr API connection successful',
          eventsFound: result.events.length 
        };
      } else {
        return { 
          success: false, 
          error: result.error 
        };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}

module.exports = new TixrAPI();