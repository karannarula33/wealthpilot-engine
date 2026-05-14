import { KiteConnect } from 'kiteconnect';
import { db } from '../../db/client';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { Holding } from '../../types';

export class ZerodhaService {
  private kite: KiteConnect;
  private userId: string;

  constructor(userId: string, apiKey?: string) {
    this.kite = new KiteConnect({
      api_key: apiKey || config.zerodha.apiKey,
    });
    this.userId = userId;
  }

  // --- Authentication ---

  getLoginUrl(): string {
    return this.kite.getLoginURL();
  }

  async authenticate(requestToken: string, apiSecret?: string): Promise<void> {
    const secret = apiSecret || config.zerodha.apiSecret;
    const session = await this.kite.generateSession(requestToken, secret);
    this.kite.setAccessToken(session.access_token);

    await db.from('users').update({
      zerodha_access_token: session.access_token,
      zerodha_token_expiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).eq('id', this.userId);

    logger.info('Zerodha session authenticated', { userId: this.userId });
  }

  async restoreSession(): Promise<boolean> {
    const user = await db.getUser(this.userId);
    if (
      user?.zerodha_access_token &&
      new Date(user.zerodha_token_expiry) > new Date()
    ) {
      this.kite.setAccessToken(user.zerodha_access_token);
      logger.debug('Zerodha session restored from DB', { userId: this.userId });
      return true;
    }
    logger.warn('Zerodha session expired or missing', { userId: this.userId });
    return false;
  }

  // --- Portfolio Data ---

  async getHoldings(): Promise<any[]> {
    try {
      const holdings = await this.kite.getHoldings();
      return holdings.map((h: any) => ({
        symbol: h.tradingsymbol,
        isin: h.isin,
        exchange: h.exchange,
        quantity: h.quantity,
        avgCostPrice: h.average_price,
        currentPrice: h.last_price,
        currentValue: h.last_price * h.quantity,
        unrealizedPnl: h.pnl,
        unrealizedPnlPct:
          h.average_price > 0
            ? ((h.last_price - h.average_price) / h.average_price) * 100
            : 0,
        dayChange: h.day_change,
        dayChangePct: h.day_change_percentage,
      }));
    } catch (error) {
      logger.error('Failed to fetch Zerodha holdings', { error, userId: this.userId });
      throw error;
    }
  }

  async getPositions(): Promise<{ net: any[]; day: any[] }> {
    return this.kite.getPositions();
  }

  async getMargins(): Promise<any> {
    return this.kite.getMargins();
  }

  async getQuotes(symbols: string[]): Promise<Record<string, any>> {
    const formatted = symbols.map((s) =>
      s.includes(':') ? s : `NSE:${s}`
    );
    return this.kite.getQuote(formatted);
  }

  async getHistoricalData(
    instrumentToken: number,
    from: Date,
    to: Date,
    interval: string = 'day'
  ): Promise<any[]> {
    return this.kite.getHistoricalData(instrumentToken, interval, from, to);
  }

  async getInstruments(exchange: string = 'NSE'): Promise<any[]> {
    return this.kite.getInstruments(exchange);
  }

  // --- Sync to DB ---

  async syncHoldingsToDb(): Promise<number> {
    const holdings = await this.getHoldings();

    for (const h of holdings) {
      const { error } = await db.from('holdings').upsert(
        {
          user_id: this.userId,
          asset_class: 'indian_equity',
          symbol: h.symbol,
          isin: h.isin,
          name: h.symbol,
          exchange: h.exchange || 'NSE',
          quantity: h.quantity,
          avg_cost_price: h.avgCostPrice,
          current_price: h.currentPrice,
          current_value: h.currentValue,
          unrealized_pnl: h.unrealizedPnl,
          unrealized_pnl_pct: h.unrealizedPnlPct,
          data_source: 'zerodha',
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,symbol,asset_class' }
      );

      if (error) {
        logger.error('Failed to upsert holding', { symbol: h.symbol, error });
      }
    }

    logger.info('Holdings synced to DB', {
      userId: this.userId,
      count: holdings.length,
    });

    return holdings.length;
  }
}
