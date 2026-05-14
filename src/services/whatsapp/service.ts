import twilio from 'twilio';
import { config } from '../../config';
import { db } from '../../db/client';
import { logger } from '../../utils/logger';
import { AIEngine } from '../ai/engine';
import { PortfolioService } from '../data/portfolio';
import { MarketDataService } from '../data/market';
import {
  formatQueryResponse,
  formatStatusMessage,
  formatHelpText,
} from './templates';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);
const FROM = `whatsapp:${config.twilio.whatsappNumber}`;

export class WhatsAppService {
  private portfolio = new PortfolioService();
  private market = new MarketDataService();
  private ai = new AIEngine();

  /**
   * Send a WhatsApp message to a user
   */
  async sendMessage(
    userId: string,
    body: string,
    alertType: string,
    recommendationIds: string[] = []
  ): Promise<string | null> {
    // Rate limit check
    const canSend = await this.canSend(userId, alertType);
    if (!canSend) {
      logger.warn('Rate limited, skipping message', { userId, alertType });
      return null;
    }

    const user = await db.getUser(userId);
    if (!user) {
      logger.error('User not found', { userId });
      return null;
    }

    // Check quiet mode for intraday
    const prefs = user.alert_preferences || {};
    if (prefs.quiet_mode && alertType === 'intraday') {
      logger.info('Quiet mode active, skipping intraday', { userId });
      return null;
    }

    // Check if this alert type is enabled
    const alertPrefMap: Record<string, string> = {
      morning_prep: 'morning_prep',
      post_settle: 'post_settle',
      evening_wrap: 'evening_wrap',
      intraday: 'intraday_alerts',
      weekly_digest: 'weekly_digest',
    };
    const prefKey = alertPrefMap[alertType];
    if (prefKey && prefs[prefKey] === false) {
      logger.info('Alert type disabled by user', { userId, alertType });
      return null;
    }

    try {
      const message = await client.messages.create({
        from: FROM,
        to: `whatsapp:${user.phone}`,
        body: body.slice(0, 4096), // WhatsApp limit
      });

      await db.logAlert({
        user_id: userId,
        alert_type: alertType,
        message_body: body,
        message_sid: message.sid,
        delivery_status: message.status,
        recommendation_ids: recommendationIds,
      });

      logger.info('WhatsApp sent', { userId, alertType, sid: message.sid });
      return message.sid;
    } catch (error: any) {
      logger.error('WhatsApp send failed', { error: error.message, userId, alertType });
      return null;
    }
  }

  /**
   * Handle inbound WhatsApp message
   * Called by Express webhook
   */
  async handleInbound(from: string, body: string): Promise<string> {
    const phone = from.replace('whatsapp:', '');
    const user = await db.getUserByPhone(phone);

    if (!user) {
      return "Sorry, I don't recognize this number. Contact the admin to get set up.";
    }

    const command = body.trim().toUpperCase();
    logger.info('Inbound WhatsApp', { userId: user.id, command: command.slice(0, 50) });

    try {
      switch (command) {
        case 'DETAILS':
          return await this.handleDetails(user.id);
        case 'YES':
          return await this.handleActed(user.id);
        case 'SKIP':
          return await this.handleSkip(user.id);
        case 'STATUS':
          return await this.handleStatus(user.id);
        case 'QUIET':
          return await this.handleQuiet(user.id);
        case 'HELP':
          return formatHelpText();
        default:
          // Free-form query to AI
          return await this.handleQuery(user.id, body);
      }
    } catch (error: any) {
      logger.error('Inbound handler error', { error: error.message, userId: user.id });
      return 'Something went wrong processing your request. Please try again.';
    }
  }

  // --- Command Handlers ---

  private async handleDetails(userId: string): Promise<string> {
    const { data: rec } = await db
      .from('recommendations')
      .select('*')
      .eq('user_id', userId)
      .eq('was_sent_via_whatsapp', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!rec) return 'No recent recommendation to expand on.';

    let msg = `📋 Detailed Analysis: ${rec.symbol || 'Portfolio'}\n\n`;
    msg += `Action: ${rec.action} [${rec.conviction}/5]\n\n`;
    msg += `${rec.reasoning}\n\n`;

    if (rec.alternatives?.length) {
      msg += `Alternatives:\n`;
      for (const a of rec.alternatives) {
        msg += `• ${a.option}: ${a.tradeoff}\n`;
      }
      msg += `\n`;
    }

    if (rec.educational_note) {
      msg += `💡 ${rec.educational_note}\n`;
    }

    if (rec.tax_impact && rec.tax_impact.type !== 'NA') {
      msg += `\nTax: ${rec.tax_impact.type}`;
      if (rec.tax_impact.estimatedAmount) {
        msg += ` — Est. ₹${rec.tax_impact.estimatedAmount}`;
      }
    }

    return msg;
  }

  private async handleActed(userId: string): Promise<string> {
    const updated = await db.updateLatestRecommendation(userId, {
      user_action: 'ACTED',
    });
    if (!updated) return 'No pending recommendation to mark.';
    return `✅ Logged: "${updated.summary}"\nI'll track the outcome for your weekly review.`;
  }

  private async handleSkip(userId: string): Promise<string> {
    const updated = await db.updateLatestRecommendation(userId, {
      user_action: 'SKIPPED',
    });
    if (!updated) return 'No pending recommendation to skip.';
    return `⏭️ Skipped: "${updated.summary}"\nWill include in weekly review.`;
  }

  private async handleStatus(userId: string): Promise<string> {
    const portfolio = await this.portfolio.getFullPortfolio(userId);
    return formatStatusMessage(portfolio.holdings, portfolio.totalValue);
  }

  private async handleQuiet(userId: string): Promise<string> {
    const user = await db.getUser(userId);
    const prefs = { ...(user.alert_preferences || {}), quiet_mode: true };

    await db.from('users').update({ alert_preferences: prefs }).eq('id', userId);

    return '🔇 Quiet mode ON. Intraday alerts paused until tomorrow.\nMorning + evening briefs will still come through.';
  }

  private async handleQuery(userId: string, query: string): Promise<string> {
    const portfolioCtx = await this.portfolio.buildPortfolioContext(userId);
    const marketCtx = await this.market.getMarketContext('post-open');

    const analysis = await this.ai.answerQuery(
      userId,
      query,
      portfolioCtx,
      marketCtx
    );

    return formatQueryResponse(analysis);
  }

  // --- Rate Limiting ---

  private async canSend(userId: string, alertType: string): Promise<boolean> {
    const limits: Record<string, { maxPerDay: number; cooldownMin: number }> = {
      morning_prep: { maxPerDay: 1, cooldownMin: 0 },
      post_settle: { maxPerDay: 1, cooldownMin: 0 },
      evening_wrap: { maxPerDay: 1, cooldownMin: 0 },
      intraday: { maxPerDay: 5, cooldownMin: 30 },
      opportunity: { maxPerDay: 1, cooldownMin: 60 },
      weekly_digest: { maxPerDay: 1, cooldownMin: 0 },
      user_response: { maxPerDay: 20, cooldownMin: 0 },
    };

    const limit = limits[alertType] || { maxPerDay: 3, cooldownMin: 30 };

    // Check daily count
    const count = await db.countTodayAlerts(userId, alertType);
    if (count >= limit.maxPerDay) return false;

    // Check total daily limit
    const totalCount = await db.countTodayAlerts(userId);
    if (totalCount >= config.alerts.maxTotalPerDay && alertType !== 'user_response') {
      return false;
    }

    // Check cooldown
    if (limit.cooldownMin > 0) {
      const lastTime = await db.getLastAlertTime(userId);
      if (lastTime) {
        const minutesSince = (Date.now() - lastTime.getTime()) / 60000;
        if (minutesSince < limit.cooldownMin) return false;
      }
    }

    return true;
  }
}
