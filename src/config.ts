import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000')),
  timezone: optional('TIMEZONE', 'Asia/Kolkata'),

  zerodha: {
    apiKey: optional('ZERODHA_API_KEY', ''),
    apiSecret: optional('ZERODHA_API_SECRET', ''),
    userId: optional('ZERODHA_USER_ID', ''),
  },

  aiProvider: optional('AI_PROVIDER', 'anthropic'), 
  
  gemini: {
    apiKey: optional('GEMINI_API_KEY', ''),
    model: 'gemini-2.5-flash',
  },

  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
    model: 'claude-sonnet-4-6-20250514',
    maxTokens: 2000,
  },

  twilio: {
    accountSid: optional('TWILIO_ACCOUNT_SID', ''),
    authToken: optional('TWILIO_AUTH_TOKEN', ''),
    whatsappNumber: optional('TWILIO_WHATSAPP_NUMBER', '+14155238886'),
  },

  supabase: {
    url: required('SUPABASE_URL'),
    serviceKey: required('SUPABASE_SERVICE_KEY'),
  },

  redis: {
    url: required('REDIS_URL'),
  },

  users: {
    karanPhone: optional('KARAN_PHONE', ''),
    shubhangiPhone: optional('SHUBHANGI_PHONE', ''),
  },

  webhookBaseUrl: optional('WEBHOOK_BASE_URL', 'http://localhost:3000'),

  // Market hours in IST (UTC+5:30)
  marketHours: {
    preMarketStart: '08:30',   // Morning prep time
    marketOpen: '09:15',
    postSettleTime: '09:45',   // Post-settle brief
    marketClose: '15:30',
    eveningWrapTime: '16:30',  // Evening wrap
  },

  // Alert limits
  alerts: {
    maxIntradayPerDay: 5,
    maxIntradayPerHour: 2,
    cooldownMinutes: 30,
    maxTotalPerDay: 8,
  },
} as const;
