import { db } from '../../db/client';
import { logger } from '../../utils/logger';
import { PortfolioSummary, HouseholdPortfolio } from '../../types';

export class PortfolioService {

  async getFullPortfolio(userId: string): Promise<PortfolioSummary> {
    const { data: holdings, error } = await db
      .from('holdings')
      .select('*')
      .eq('user_id', userId)
      .order('current_value', { ascending: false });

    if (error) throw error;
    if (!holdings || holdings.length === 0) return this.emptyPortfolio();

    const totalValue = holdings.reduce((s: number, h: any) => s + (h.current_value || 0), 0);
    const totalInvested = holdings.reduce(
      (s: number, h: any) => s + h.avg_cost_price * h.quantity, 0
    );

    const allocationByAssetClass: Record<string, number> = {};
    const allocationBySector: Record<string, number> = {};

    for (const h of holdings) {
      const pct = totalValue > 0 ? ((h.current_value || 0) / totalValue) * 100 : 0;
      allocationByAssetClass[h.asset_class] =
        (allocationByAssetClass[h.asset_class] || 0) + pct;
      if (h.sector) {
        allocationBySector[h.sector] =
          (allocationBySector[h.sector] || 0) + pct;
      }
    }

    return {
      totalValue,
      totalInvested,
      totalPnl: totalValue - totalInvested,
      totalPnlPct: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      dayChange: holdings.reduce((s: number, h: any) => s + (h.day_change || 0), 0),
      dayChangePct: 0,
      allocationByAssetClass,
      allocationBySector,
      holdings,
      lastUpdated: new Date(),
    };
  }

  async getHouseholdPortfolio(): Promise<HouseholdPortfolio> {
    const users = await db.getAllUsers();
    const portfolios: Record<string, PortfolioSummary> = {};

    for (const user of users) {
      portfolios[user.name.toLowerCase()] = await this.getFullPortfolio(user.id);
    }

    return {
      combined: this.mergePortfolios(Object.values(portfolios)),
      karan: portfolios['karan'] || this.emptyPortfolio(),
      shubhangi: portfolios['shubhangi'] || this.emptyPortfolio(),
    };
  }

  async takeSnapshot(userId: string): Promise<void> {
    const portfolio = await this.getFullPortfolio(userId);
    const today = new Date().toISOString().split('T')[0];

    const { error } = await db.from('portfolio_snapshots').upsert(
      {
        user_id: userId,
        snapshot_date: today,
        total_value: portfolio.totalValue,
        total_invested: portfolio.totalInvested,
        total_pnl: portfolio.totalPnl,
        total_pnl_pct: portfolio.totalPnlPct,
        day_change: portfolio.dayChange,
        day_change_pct: portfolio.dayChangePct,
        allocation_by_asset_class: portfolio.allocationByAssetClass,
        allocation_by_sector: portfolio.allocationBySector,
      },
      { onConflict: 'user_id,snapshot_date' }
    );

    if (error) {
      logger.error('Failed to save portfolio snapshot', { error, userId });
    } else {
      logger.info('Portfolio snapshot saved', { userId, date: today, value: portfolio.totalValue });
    }
  }

  /**
   * Build portfolio context string for AI prompts
   */
  async buildPortfolioContext(userId: string): Promise<string> {
    const portfolio = await this.getFullPortfolio(userId);
    const user = await db.getUser(userId);

    let ctx = `## ${user.name}'s Portfolio\n`;
    ctx += `Risk Profile: ${user.risk_profile}\n`;
    ctx += `Has Salary Income: ${user.has_salary_income}\n`;
    ctx += `Total Value: ₹${this.formatLakhs(portfolio.totalValue)}\n`;
    ctx += `Total Invested: ₹${this.formatLakhs(portfolio.totalInvested)}\n`;
    ctx += `Total P&L: ₹${this.formatLakhs(portfolio.totalPnl)} (${portfolio.totalPnlPct.toFixed(1)}%)\n\n`;

    if (portfolio.holdings.length > 0) {
      ctx += `### Holdings (${portfolio.holdings.length} positions)\n`;
      ctx += `| Symbol | Qty | Avg Cost | CMP | Value (₹) | P&L % | Sector | Asset |\n`;
      ctx += `|--------|-----|----------|-----|-----------|-------|--------|-------|\n`;

      for (const h of portfolio.holdings) {
        ctx += `| ${h.symbol || h.name} | ${h.quantity} | ${h.avg_cost_price?.toFixed(2)} | ${h.current_price?.toFixed(2) || '-'} | ${this.formatLakhs(h.current_value)} | ${h.unrealized_pnl_pct?.toFixed(1) || '0'}% | ${h.sector || '-'} | ${h.asset_class} |\n`;
      }

      ctx += `\n### Allocation\n`;
      ctx += `Asset Class: ${JSON.stringify(portfolio.allocationByAssetClass, null, 0)}\n`;
      if (Object.keys(portfolio.allocationBySector).length > 0) {
        ctx += `Sector: ${JSON.stringify(portfolio.allocationBySector, null, 0)}\n`;
      }
    } else {
      ctx += `No holdings found.\n`;
    }

    ctx += `\n### Risk Limits\n`;
    ctx += `Max single stock: ${user.max_single_stock_pct}% | Max sector: ${user.max_sector_pct}%\n`;

    return ctx;
  }

  /**
   * Build combined household context for AI
   */
  async buildHouseholdContext(): Promise<string> {
    const users = await db.getAllUsers();
    let ctx = `# Household Portfolio Overview\n\n`;

    for (const user of users) {
      ctx += await this.buildPortfolioContext(user.id);
      ctx += `\n---\n\n`;
    }

    return ctx;
  }

  private formatLakhs(value: number): string {
    if (Math.abs(value) >= 100000) {
      return `${(value / 100000).toFixed(2)}L`;
    }
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toFixed(0);
  }

  private emptyPortfolio(): PortfolioSummary {
    return {
      totalValue: 0, totalInvested: 0, totalPnl: 0, totalPnlPct: 0,
      dayChange: 0, dayChangePct: 0,
      allocationByAssetClass: {}, allocationBySector: {},
      holdings: [], lastUpdated: new Date(),
    };
  }

  private mergePortfolios(portfolios: PortfolioSummary[]): PortfolioSummary {
    const totalValue = portfolios.reduce((s, p) => s + p.totalValue, 0);
    const totalInvested = portfolios.reduce((s, p) => s + p.totalInvested, 0);
    const allHoldings = portfolios.flatMap((p) => p.holdings);

    const allocationByAssetClass: Record<string, number> = {};
    const allocationBySector: Record<string, number> = {};
    for (const h of allHoldings) {
      const pct = totalValue > 0 ? ((h.current_value || 0) / totalValue) * 100 : 0;
      allocationByAssetClass[h.asset_class] = (allocationByAssetClass[h.asset_class] || 0) + pct;
      if (h.sector) {
        allocationBySector[h.sector] = (allocationBySector[h.sector] || 0) + pct;
      }
    }

    return {
      totalValue,
      totalInvested,
      totalPnl: totalValue - totalInvested,
      totalPnlPct: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      dayChange: portfolios.reduce((s, p) => s + p.dayChange, 0),
      dayChangePct: 0,
      allocationByAssetClass,
      allocationBySector,
      holdings: allHoldings,
      lastUpdated: new Date(),
    };
  }
}
