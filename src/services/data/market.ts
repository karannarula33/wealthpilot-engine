import { logger } from '../../utils/logger';
import { db } from '../../db/client';

/**
 * Fetch market context from multiple sources
 * Stores in market_context table for caching
 */
export class MarketDataService {

  /**
   * Fetch comprehensive market context for AI consumption
   */
  async getMarketContext(phase: 'pre-market' | 'post-open' | 'close'): Promise<string> {
    let ctx = `## Market Context (${phase})\n`;
    ctx += `Timestamp: ${new Date().toISOString()}\n\n`;

    try {
      // Attempt to fetch live data — falls back gracefully
      const niftyData = await this.fetchNiftyData();
      const globalData = await this.fetchGlobalIndices();
      const fiiDiiData = await this.fetchFiiDii();

      ctx += `### Indian Markets\n`;
      ctx += `Nifty 50: ${niftyData.price} (${niftyData.changePct > 0 ? '+' : ''}${niftyData.changePct}%)\n`;
      ctx += `India VIX: ${niftyData.vix}\n\n`;

      ctx += `### Global Cues\n`;
      ctx += `S&P 500: ${globalData.sp500} (${globalData.sp500ChangePct > 0 ? '+' : ''}${globalData.sp500ChangePct}%)\n`;
      ctx += `Nasdaq: ${globalData.nasdaq}\n`;
      ctx += `USD/INR: ${globalData.usdInr}\n`;
      ctx += `Gold (INR): ₹${globalData.goldInr}/10g\n`;
      ctx += `Crude Oil: $${globalData.crudeOil}/bbl\n\n`;

      ctx += `### FII/DII Activity\n`;
      ctx += `FII Net: ₹${fiiDiiData.fiiNet} Cr\n`;
      ctx += `DII Net: ₹${fiiDiiData.diiNet} Cr\n`;

      // Store in DB for historical reference
      await this.storeContext(niftyData, globalData, fiiDiiData);

    } catch (error) {
      logger.error('Failed to fetch some market data', { error });
      ctx += `(Some market data unavailable — using last known values)\n`;

      // Fall back to last stored context
      const lastCtx = await this.getLastStoredContext();
      if (lastCtx) {
        ctx += `Last known Nifty: ${lastCtx.nifty_50}\n`;
        ctx += `Last known FII: ${lastCtx.fii_net} Cr\n`;
      }
    }

    return ctx;
  }

  /**
   * Fetch Nifty data
   * Uses Yahoo Finance as primary source
   */
  private async fetchNiftyData(): Promise<{
    price: number;
    changePct: number;
    vix: number;
  }> {
    try {
      // Dynamic import to handle potential module issues
      const yahooFinance = await import('yahoo-finance2');
      const yf = yahooFinance.default;

      const nifty = await yf.quote('^NSEI');
      const vix = await yf.quote('^INDIAVIX');

      return {
        price: nifty.regularMarketPrice || 0,
        changePct: nifty.regularMarketChangePercent || 0,
        vix: vix.regularMarketPrice || 0,
      };
    } catch (error) {
      logger.warn('Yahoo Finance fetch failed for Nifty', { error });
      return { price: 0, changePct: 0, vix: 0 };
    }
  }

  /**
   * Fetch global indices
   */
  private async fetchGlobalIndices(): Promise<{
    sp500: number;
    sp500ChangePct: number;
    nasdaq: number;
    usdInr: number;
    goldInr: number;
    crudeOil: number;
  }> {
    try {
      const yahooFinance = await import('yahoo-finance2');
      const yf = yahooFinance.default;

      const [sp500, nasdaq, usdInr, gold, crude] = await Promise.allSettled([
        yf.quote('^GSPC'),
        yf.quote('^IXIC'),
        yf.quote('INR=X'),
        yf.quote('GC=F'),
        yf.quote('CL=F'),
      ]);

      const getVal = (r: PromiseSettledResult<any>, field: string) =>
        r.status === 'fulfilled' ? r.value?.[field] || 0 : 0;

      const usdInrRate = getVal(usdInr, 'regularMarketPrice');
      const goldUsd = getVal(gold, 'regularMarketPrice');
      // Convert gold from USD/oz to INR/10g (1 oz = 31.1035g)
      const goldInrPer10g = (goldUsd / 31.1035) * 10 * usdInrRate;

      return {
        sp500: getVal(sp500, 'regularMarketPrice'),
        sp500ChangePct: getVal(sp500, 'regularMarketChangePercent'),
        nasdaq: getVal(nasdaq, 'regularMarketPrice'),
        usdInr: usdInrRate,
        goldInr: Math.round(goldInrPer10g),
        crudeOil: getVal(crude, 'regularMarketPrice'),
      };
    } catch (error) {
      logger.warn('Global indices fetch failed', { error });
      return { sp500: 0, sp500ChangePct: 0, nasdaq: 0, usdInr: 0, goldInr: 0, crudeOil: 0 };
    }
  }

  /**
   * Fetch FII/DII data
   * Note: Real-time FII/DII is tricky — NSDL publishes with delay
   * For V1, we use a placeholder that you can replace with a scraper
   */
  private async fetchFiiDii(): Promise<{ fiiNet: number; diiNet: number }> {
    // TODO: Implement NSDL/MoneyControl scraper for real FII/DII data
    // For now, return placeholder
    return { fiiNet: 0, diiNet: 0 };
  }

  private async storeContext(
    nifty: any,
    global: any,
    fiiDii: any
  ): Promise<void> {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];

    await db.from('market_context').upsert(
      {
        context_date: date,
        context_time: time,
        nifty_50: nifty.price,
        nifty_change_pct: nifty.changePct,
        india_vix: nifty.vix,
        sp500: global.sp500,
        nasdaq: global.nasdaq,
        usd_inr: global.usdInr,
        gold_inr: global.goldInr,
        crude_oil: global.crudeOil,
        fii_net: fiiDii.fiiNet,
        dii_net: fiiDii.diiNet,
      },
      { onConflict: 'context_date,context_time' }
    );
  }

  private async getLastStoredContext(): Promise<any | null> {
    const { data } = await db
      .from('market_context')
      .select('*')
      .order('context_date', { ascending: false })
      .limit(1)
      .single();
    return data;
  }
}
