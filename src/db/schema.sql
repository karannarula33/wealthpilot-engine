-- ============================================
-- WealthPilot Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & PROFILES
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(255),
  risk_profile VARCHAR(25) NOT NULL DEFAULT 'moderate',
  max_single_stock_pct DECIMAL(5,2) DEFAULT 15.00,
  max_sector_pct DECIMAL(5,2) DEFAULT 30.00,
  tax_slab VARCHAR(20) DEFAULT '30pct',
  has_salary_income BOOLEAN DEFAULT true,
  zerodha_api_key VARCHAR(50),
  zerodha_api_secret VARCHAR(100),
  zerodha_access_token TEXT,
  zerodha_token_expiry TIMESTAMP WITH TIME ZONE,
  alert_preferences JSONB DEFAULT '{
    "morning_prep": true,
    "post_settle": true,
    "evening_wrap": true,
    "intraday_alerts": true,
    "weekly_digest": true,
    "quiet_mode": false,
    "max_intraday_alerts": 5
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- HOLDINGS
-- ============================================

DO $$ BEGIN
  CREATE TYPE asset_class AS ENUM (
    'indian_equity', 'mutual_fund', 'etf', 'us_equity',
    'fixed_deposit', 'bond', 'gold', 'ppf', 'epf', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE data_source AS ENUM (
    'zerodha', 'manual', 'csv_import', 'amfi', 'yahoo'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS holdings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  asset_class asset_class NOT NULL,
  symbol VARCHAR(50),
  isin VARCHAR(20),
  name VARCHAR(200) NOT NULL,
  exchange VARCHAR(10),
  sector VARCHAR(100),
  quantity DECIMAL(15,4) NOT NULL,
  avg_cost_price DECIMAL(15,4) NOT NULL,
  current_price DECIMAL(15,4),
  current_value DECIMAL(15,2),
  unrealized_pnl DECIMAL(15,2),
  unrealized_pnl_pct DECIMAL(8,4),
  purchase_date DATE,
  is_long_term BOOLEAN,
  data_source data_source NOT NULL,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  maturity_date DATE,
  interest_rate DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, symbol, asset_class)
);

CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_symbol ON holdings(symbol);
CREATE INDEX IF NOT EXISTS idx_holdings_asset_class ON holdings(user_id, asset_class);

-- ============================================
-- PORTFOLIO SNAPSHOTS
-- ============================================

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_value DECIMAL(15,2) NOT NULL,
  total_invested DECIMAL(15,2) NOT NULL,
  total_pnl DECIMAL(15,2),
  total_pnl_pct DECIMAL(8,4),
  day_change DECIMAL(15,2),
  day_change_pct DECIMAL(8,4),
  allocation_by_asset_class JSONB,
  allocation_by_sector JSONB,
  nifty_close DECIMAL(10,2),
  sensex_close DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_date
  ON portfolio_snapshots(user_id, snapshot_date DESC);

-- ============================================
-- PRICE ALERTS
-- ============================================

DO $$ BEGIN
  CREATE TYPE alert_trigger_type AS ENUM (
    'price_above', 'price_below',
    'pct_change_up', 'pct_change_down',
    'dma_200_cross_above', 'dma_200_cross_below',
    'rsi_oversold', 'rsi_overbought',
    'volume_spike', 'earnings_release', 'stop_loss'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS price_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  exchange VARCHAR(10) DEFAULT 'NSE',
  trigger_type alert_trigger_type NOT NULL,
  trigger_value DECIMAL(15,4),
  is_active BOOLEAN DEFAULT true,
  is_one_time BOOLEAN DEFAULT false,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  trigger_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_active
  ON price_alerts(is_active, symbol);

-- ============================================
-- RECOMMENDATIONS
-- ============================================

DO $$ BEGIN
  CREATE TYPE recommendation_action AS ENUM (
    'BUY', 'SELL', 'HOLD', 'WATCH', 'TRIM', 'ADD', 'NO_ACTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_priority AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INFO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  trigger_type VARCHAR(50) NOT NULL,
  trigger_context JSONB,
  symbol VARCHAR(50),
  action recommendation_action NOT NULL,
  conviction INTEGER CHECK (conviction BETWEEN 1 AND 5),
  priority alert_priority DEFAULT 'MEDIUM',
  summary TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  alternatives JSONB,
  educational_note TEXT,
  tax_impact JSONB,
  raw_ai_response JSONB,
  tokens_used JSONB,
  was_sent_via_whatsapp BOOLEAN DEFAULT false,
  whatsapp_message_sid VARCHAR(50),
  user_action VARCHAR(20) DEFAULT 'PENDING',
  outcome_price DECIMAL(15,4),
  outcome_date DATE,
  outcome_result VARCHAR(20),
  outcome_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user
  ON recommendations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_symbol
  ON recommendations(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_pending
  ON recommendations(user_id, user_action) WHERE user_action = 'PENDING';

-- ============================================
-- ALERTS LOG
-- ============================================

CREATE TABLE IF NOT EXISTS alerts_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  alert_type VARCHAR(30) NOT NULL,
  channel VARCHAR(20) DEFAULT 'whatsapp',
  message_body TEXT NOT NULL,
  message_sid VARCHAR(50),
  delivery_status VARCHAR(20),
  recommendation_ids UUID[],
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_log_user
  ON alerts_log(user_id, sent_at DESC);

-- ============================================
-- DECISION JOURNAL
-- ============================================

CREATE TABLE IF NOT EXISTS decision_journal (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  entry_date DATE DEFAULT CURRENT_DATE,
  entry_type VARCHAR(20) NOT NULL,
  symbol VARCHAR(50),
  action_taken VARCHAR(200),
  reasoning TEXT,
  recommendation_id UUID REFERENCES recommendations(id),
  outcome TEXT,
  outcome_date DATE,
  lesson_learned TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- MARKET CONTEXT
-- ============================================

CREATE TABLE IF NOT EXISTS market_context (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  context_date DATE NOT NULL,
  context_time TIME,
  nifty_50 DECIMAL(10,2),
  nifty_change_pct DECIMAL(6,3),
  sensex DECIMAL(10,2),
  india_vix DECIMAL(8,4),
  fii_net DECIMAL(15,2),
  dii_net DECIMAL(15,2),
  sp500 DECIMAL(10,2),
  nasdaq DECIMAL(10,2),
  dow DECIMAL(10,2),
  us_10yr_yield DECIMAL(6,4),
  gold_usd DECIMAL(10,2),
  gold_inr DECIMAL(10,2),
  crude_oil DECIMAL(10,2),
  usd_inr DECIMAL(8,4),
  rbi_repo_rate DECIMAL(5,2),
  sector_indices JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(context_date, context_time)
);

-- ============================================
-- WATCHLIST
-- ============================================

CREATE TABLE IF NOT EXISTS watchlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  symbol VARCHAR(50) NOT NULL,
  exchange VARCHAR(10) DEFAULT 'NSE',
  name VARCHAR(200),
  entry_thesis TEXT,
  target_entry_low DECIMAL(15,4),
  target_entry_high DECIMAL(15,4),
  target_exit DECIMAL(15,4),
  stop_loss DECIMAL(15,4),
  added_by VARCHAR(20) DEFAULT 'user',
  recommendation_id UUID REFERENCES recommendations(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- VIEWS
-- ============================================

CREATE OR REPLACE VIEW household_portfolio AS
SELECT
  h.asset_class,
  h.sector,
  u.name as owner,
  SUM(h.current_value) as total_value,
  SUM(h.unrealized_pnl) as total_pnl,
  COUNT(*) as position_count
FROM holdings h
JOIN users u ON h.user_id = u.id
GROUP BY h.asset_class, h.sector, u.name;

CREATE OR REPLACE VIEW recommendation_accuracy AS
SELECT
  DATE_TRUNC('month', created_at) as month,
  conviction,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE outcome_result = 'PROFITABLE') as profitable,
  COUNT(*) FILTER (WHERE outcome_result = 'LOSS') as losses,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE outcome_result = 'PROFITABLE') /
    NULLIF(COUNT(*) FILTER (WHERE outcome_result IN ('PROFITABLE', 'LOSS')), 0),
    1
  ) as accuracy_pct
FROM recommendations
WHERE user_action = 'ACTED'
GROUP BY DATE_TRUNC('month', created_at), conviction
ORDER BY month DESC, conviction DESC;

-- ============================================
-- AUTO-UPDATE TIMESTAMPS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_holdings_updated_at ON holdings;
CREATE TRIGGER update_holdings_updated_at
  BEFORE UPDATE ON holdings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_watchlist_updated_at ON watchlist;
CREATE TRIGGER update_watchlist_updated_at
  BEFORE UPDATE ON watchlist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
