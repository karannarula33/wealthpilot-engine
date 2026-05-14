// ============================================
// Portfolio Types
// ============================================

export type AssetClass =
  | 'indian_equity'
  | 'mutual_fund'
  | 'etf'
  | 'us_equity'
  | 'fixed_deposit'
  | 'bond'
  | 'gold'
  | 'ppf'
  | 'epf'
  | 'other';

export type DataSource = 'zerodha' | 'manual' | 'csv_import' | 'amfi' | 'yahoo';

export interface Holding {
  id: string;
  userId: string;
  assetClass: AssetClass;
  symbol: string;
  isin?: string;
  name: string;
  exchange?: string;
  sector?: string;
  quantity: number;
  avgCostPrice: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  purchaseDate?: string;
  isLongTerm?: boolean;
  dataSource: DataSource;
  lastSyncedAt?: string;
  // FD/Bond specific
  maturityDate?: string;
  interestRate?: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  allocationByAssetClass: Record<string, number>;
  allocationBySector: Record<string, number>;
  holdings: Holding[];
  lastUpdated: Date;
}

export interface HouseholdPortfolio {
  combined: PortfolioSummary;
  karan: PortfolioSummary;
  shubhangi: PortfolioSummary;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  riskProfile: string;
  maxSingleStockPct: number;
  maxSectorPct: number;
  taxSlab: string;
  hasSalaryIncome: boolean;
  zerodhaApiKey?: string;
  zerodhaApiSecret?: string;
  zerodhaAccessToken?: string;
  zerodhaTokenExpiry?: string;
  alertPreferences: AlertPreferences;
}

export interface AlertPreferences {
  morningPrep: boolean;
  postSettle: boolean;
  eveningWrap: boolean;
  intradayAlerts: boolean;
  weeklyDigest: boolean;
  quietMode: boolean;
  maxIntradayAlerts: number;
}

// ============================================
// Event Types
// ============================================

export type EventType =
  | 'SCHEDULED_BRIEF'
  | 'PRICE_ALERT'
  | 'NEWS_EVENT'
  | 'VOLUME_SPIKE'
  | 'TECHNICAL_SIGNAL'
  | 'USER_QUERY'
  | 'WEEKLY_DIGEST';

export type BriefType =
  | 'morning_prep'
  | 'post_settle'
  | 'evening_wrap'
  | 'weekly_digest';

export interface AnalysisEvent {
  type: EventType;
  briefType?: BriefType;
  symbol?: string;
  context: string;
  data?: Record<string, any>;
  userId?: string;
  timestamp: Date;
}

// ============================================
// AI Types
// ============================================

export type RecommendationAction =
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'WATCH'
  | 'TRIM'
  | 'ADD'
  | 'NO_ACTION';

export type AlertPriority = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface AIAnalysisInput {
  eventType: string;
  eventContext: string;
  portfolioContext: string;
  marketContext: string;
  technicalData?: string;
  newsContext?: string;
  userQuery?: string;
  userId?: string;
}

export interface AIAnalysisOutput {
  action: RecommendationAction;
  conviction: number;
  priority: AlertPriority;
  summary: string;
  reasoning: string;
  alternatives: Array<{ option: string; tradeoff: string }>;
  educationalNote: string;
  taxImpact?: { type: string; estimatedAmount: number | null };
  symbols?: string[];
}

export interface AIUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  latencyMs: number;
}

// ============================================
// Alert Types
// ============================================

export type AlertTriggerType =
  | 'price_above'
  | 'price_below'
  | 'pct_change_up'
  | 'pct_change_down'
  | 'dma_200_cross_above'
  | 'dma_200_cross_below'
  | 'rsi_oversold'
  | 'rsi_overbought'
  | 'volume_spike'
  | 'earnings_release'
  | 'stop_loss';

export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  exchange: string;
  triggerType: AlertTriggerType;
  triggerValue: number;
  isActive: boolean;
  isOneTime: boolean;
  lastTriggeredAt?: string;
  triggerCount: number;
  notes?: string;
}

export interface Recommendation {
  id: string;
  userId: string;
  triggerType: string;
  triggerContext?: Record<string, any>;
  symbol?: string;
  action: RecommendationAction;
  conviction: number;
  priority: AlertPriority;
  summary: string;
  reasoning: string;
  alternatives?: Array<{ option: string; tradeoff: string }>;
  educationalNote?: string;
  taxImpact?: { type: string; estimatedAmount: number | null };
  rawAiResponse?: Record<string, any>;
  tokensUsed?: AIUsageStats;
  wasSentViaWhatsapp: boolean;
  whatsappMessageSid?: string;
  userAction?: 'ACTED' | 'SKIPPED' | 'PENDING';
  outcomePrice?: number;
  outcomeDate?: string;
  outcomeResult?: 'PROFITABLE' | 'LOSS' | 'NEUTRAL' | 'TOO_EARLY';
  outcomeNotes?: string;
  createdAt: string;
}

// ============================================
// Market Context
// ============================================

export interface MarketContext {
  nifty50: number;
  niftyChangePct: number;
  sensex: number;
  indiaVix: number;
  fiiNet: number;
  diiNet: number;
  sp500: number;
  nasdaq: number;
  goldInr: number;
  crudeOil: number;
  usdInr: number;
  sectorIndices: Record<string, number>;
  timestamp: Date;
}

// ============================================
// Technical Analysis
// ============================================

export interface OHLC {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalSummary {
  symbol: string;
  currentPrice: number;
  dma200: number;
  dma50: number;
  aboveDma200: boolean;
  aboveDma50: boolean;
  rsi: number;
  rsiSignal: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL';
  macdSignal: 'BULLISH' | 'BEARISH';
  supports: number[];
  resistances: number[];
  volumeAvg20: number;
  volumeToday: number;
  volumeRatio: number;
}
