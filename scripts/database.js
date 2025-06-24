// scripts/database.js - Database operations
const { createClient } = require('@supabase/supabase-js');

class DatabaseManager {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }

  /**
   * Register a new user
   */
  async registerUser(phoneNumber, username, role = 'USER') {
    try {
      const { data, error } = await this.supabase
        .from('bot_users')
        .upsert({
          bot_userphone: phoneNumber,
          bot_username: username,
          bot_userstatus: 'OPTIN',
          bot_userrole: role,
        }, { onConflict: 'bot_userphone' });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Database registration error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user by phone number
   */
  async getUser(phoneNumber) {
    try {
      const { data, error } = await this.supabase
        .from('bot_users')
        .select('*')
        .eq('bot_userphone', phoneNumber)
        .maybeSingle();

      if (error) throw error;
      return { success: true, user: data };
    } catch (error) {
      console.error('Database fetch user error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unregister user
   */
  async unregisterUser(phoneNumber) {
    try {
      const { error } = await this.supabase
        .from('bot_users')
        .delete()
        .eq('bot_userphone', phoneNumber);

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Database unregister error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    try {
      const { data, error } = await this.supabase
        .from('bot_users')
        .select('bot_username, bot_userphone, bot_userrole')
        .order('bot_username');

      if (error) throw error;
      return { success: true, users: data || [] };
    } catch (error) {
      console.error('Database fetch all users error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find user by username (fuzzy search)
   */
  async findUserByName(username) {
    try {
      const { data, error } = await this.supabase
        .from('bot_users')
        .select('*')
        .ilike('bot_username', username)
        .maybeSingle();

      if (error) throw error;
      return { success: true, user: data };
    } catch (error) {
      console.error('Database find user error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update user status
   */
  async updateUserStatus(phoneNumber, status) {
    try {
      const { data, error } = await this.supabase
        .from('bot_users')
        .update({ bot_userstatus: status })
        .eq('bot_userphone', phoneNumber);

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Database update status error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test database connection
   */
  async testConnection() {
    try {
      const { data, error } = await this.supabase
        .from('bot_users')
        .select('count')
        .limit(1);

      if (error) throw error;
      return { success: true, message: 'Database connection successful' };
    } catch (error) {
      console.error('Database connection test failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new DatabaseManager();