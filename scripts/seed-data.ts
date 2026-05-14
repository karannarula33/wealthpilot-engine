/**
 * Seed script — run once to create initial users
 * Usage: npx tsx scripts/seed-data.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

async function seed() {
  console.log('Seeding WealthPilot database...\n');

  // --- Create Users ---
  const users = [
    {
      name: 'Karan',
      phone: process.env.KARAN_PHONE || '+910000000000',
      risk_profile: 'moderate-aggressive',
      max_single_stock_pct: 15,
      max_sector_pct: 30,
      tax_slab: '30pct',
      has_salary_income: false,
      zerodha_api_key: process.env.ZERODHA_API_KEY || null,
      zerodha_api_secret: process.env.ZERODHA_API_SECRET || null,
      alert_preferences: {
        morning_prep: true,
        post_settle: true,
        evening_wrap: true,
        intraday_alerts: true,
        weekly_digest: true,
        quiet_mode: false,
        max_intraday_alerts: 5,
      },
    },
    {
      name: 'Shubhangi',
      phone: process.env.SHUBHANGI_PHONE || '+910000000001',
      risk_profile: 'moderate-conservative',
      max_single_stock_pct: 12,
      max_sector_pct: 25,
      tax_slab: '0pct', // No salary income
      has_salary_income: false,
      alert_preferences: {
        morning_prep: true,
        post_settle: true,
        evening_wrap: true,
        intraday_alerts: true,
        weekly_digest: true,
        quiet_mode: false,
        max_intraday_alerts: 3,
      },
    },
  ];

  for (const user of users) {
    const { data, error } = await supabase
      .from('users')
      .upsert(user, { onConflict: 'phone' })
      .select()
      .single();

    if (error) {
      console.error(`Failed to create ${user.name}:`, error.message);
    } else {
      console.log(`✅ User created: ${data.name} (${data.id})`);
    }
  }

  // --- Sample Holdings (remove after connecting Zerodha) ---
  const { data: karan } = await supabase
    .from('users')
    .select('id')
    .eq('name', 'Karan')
    .single();

  if (karan) {
    const sampleHoldings = [
      {
        user_id: karan.id,
        asset_class: 'indian_equity',
        symbol: 'TCS',
        name: 'Tata Consultancy Services',
        exchange: 'NSE',
        sector: 'IT',
        quantity: 20,
        avg_cost_price: 3650,
        current_price: 3890,
        current_value: 77800,
        unrealized_pnl: 4800,
        unrealized_pnl_pct: 6.58,
        data_source: 'manual',
      },
      {
        user_id: karan.id,
        asset_class: 'indian_equity',
        symbol: 'HDFCBANK',
        name: 'HDFC Bank',
        exchange: 'NSE',
        sector: 'Banking',
        quantity: 50,
        avg_cost_price: 1580,
        current_price: 1645,
        current_value: 82250,
        unrealized_pnl: 3250,
        unrealized_pnl_pct: 4.11,
        data_source: 'manual',
      },
      {
        user_id: karan.id,
        asset_class: 'indian_equity',
        symbol: 'TATAMOTORS',
        name: 'Tata Motors',
        exchange: 'NSE',
        sector: 'Auto',
        quantity: 100,
        avg_cost_price: 640,
        current_price: 612,
        current_value: 61200,
        unrealized_pnl: -2800,
        unrealized_pnl_pct: -4.38,
        data_source: 'manual',
      },
      {
        user_id: karan.id,
        asset_class: 'mutual_fund',
        symbol: 'NIFTY50_INDEX',
        name: 'UTI Nifty 50 Index Fund',
        exchange: 'AMFI',
        sector: null,
        quantity: 500,
        avg_cost_price: 145,
        current_price: 158,
        current_value: 79000,
        unrealized_pnl: 6500,
        unrealized_pnl_pct: 8.97,
        data_source: 'manual',
      },
      {
        user_id: karan.id,
        asset_class: 'gold',
        symbol: 'GOLDBEES',
        name: 'Nippon Gold ETF',
        exchange: 'NSE',
        sector: null,
        quantity: 100,
        avg_cost_price: 52,
        current_price: 61,
        current_value: 6100,
        unrealized_pnl: 900,
        unrealized_pnl_pct: 17.31,
        data_source: 'manual',
      },
    ];

    for (const h of sampleHoldings) {
      const { error } = await supabase
        .from('holdings')
        .upsert(h, { onConflict: 'user_id,symbol,asset_class' });
      if (error) {
        console.error(`Failed to insert ${h.symbol}:`, error.message);
      } else {
        console.log(`  📊 Holding: ${h.symbol} (${h.asset_class})`);
      }
    }
  }

  console.log('\n✅ Seed complete!');
  console.log('\nNext steps:');
  console.log('1. Update phone numbers in .env');
  console.log('2. Run: npx tsx src/index.ts');
  console.log('3. Visit: http://localhost:3000/api/auth/zerodha/login?user_id=YOUR_ID');
}

seed().catch(console.error);
