import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../utils/logger';

let supabase: SupabaseClient;

export function getDb(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
    });
    logger.info('Supabase client initialized');
  }
  return supabase;
}

export const db = {
  /**
   * Shorthand for common operations
   */
  from(table: string) {
    return getDb().from(table);
  },

  /**
   * Run raw SQL via RPC (for complex queries)
   */
  async rpc(fn: string, params?: Record<string, any>) {
    return getDb().rpc(fn, params);
  },

  /**
   * Get a single user by ID
   */
  async getUser(userId: string) {
    const { data, error } = await getDb()
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Get all active users
   */
  async getAllUsers() {
    const { data, error } = await getDb()
      .from('users')
      .select('*')
      .order('name');
    if (error) throw error;
    return data || [];
  },

  /**
   * Get user by phone number (for WhatsApp inbound)
   */
  async getUserByPhone(phone: string) {
    const { data, error } = await getDb()
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Store a recommendation
   */
  async saveRecommendation(rec: Record<string, any>) {
    const { data, error } = await getDb()
      .from('recommendations')
      .insert(rec)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Log a sent alert
   */
  async logAlert(alert: Record<string, any>) {
    const { error } = await getDb().from('alerts_log').insert(alert);
    if (error) logger.error('Failed to log alert', { error });
  },

  /**
   * Get today's recommendations for a user
   */
  async getTodayRecommendations(userId: string) {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await getDb()
      .from('recommendations')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', today)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * Get recent recommendations for weekly digest
   */
  async getWeekRecommendations(userId: string) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getDb()
      .from('recommendations')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * Count alerts sent today for rate limiting
   */
  async countTodayAlerts(userId: string, alertType?: string) {
    const today = new Date().toISOString().split('T')[0];
    let query = getDb()
      .from('alerts_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('sent_at', today);
    if (alertType) query = query.eq('alert_type', alertType);
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  },

  /**
   * Get last alert timestamp for cooldown check
   */
  async getLastAlertTime(userId: string): Promise<Date | null> {
    const { data, error } = await getDb()
      .from('alerts_log')
      .select('sent_at')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data ? new Date(data.sent_at) : null;
  },

  /**
   * Update the most recent pending recommendation
   */
  async updateLatestRecommendation(userId: string, update: Record<string, any>) {
    const { data, error } = await getDb()
      .from('recommendations')
      .update(update)
      .eq('user_id', userId)
      .eq('user_action', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(1)
      .select()
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
};
