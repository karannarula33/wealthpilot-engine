import twilio from 'twilio';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { logger } from './utils/logger';
import { WhatsAppService } from './services/whatsapp/service';
import { ZerodhaService } from './services/data/zerodha';
import { PortfolioService } from './services/data/portfolio';
import { MarketDataService } from './services/data/market';
import { AIEngine } from './services/ai/engine';
import { startScheduler, runManualJob } from './services/scheduler';
import { db } from './db/client';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const whatsapp = new WhatsAppService();
const portfolio = new PortfolioService();
const market = new MarketDataService();
const ai = new AIEngine();

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (_req, res) => {
  res.json({
    service: 'WealthPilot',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ============================================
// TWILIO WHATSAPP WEBHOOK
// ============================================

app.post('/api/webhook/whatsapp', async (req, res) => {
  try {
    const { From, Body } = req.body;

    // --- SECURITY 1: SENDER CHECK ---
    const myNumber = `whatsapp:${process.env.KARAN_PHONE}`;
    if (From !== myNumber) {
      logger.warn('🚨 SECURITY: Unauthorized sender blocked', { from: From });
      return res.status(403).send('Unauthorized');
    }

    // --- SECURITY 2: CRYPTOGRAPHIC SIGNATURE ---
    const twilioSignature = req.headers['x-twilio-signature'] as string;
    const webhookUrl = process.env.PUBLIC_WEBHOOK_URL!; 

    const isValid = twilio.validateRequest(
      config.twilio.authToken, // This uses your config.ts setup
      twilioSignature,
      webhookUrl,
      req.body
    );

    if (!isValid) {
      logger.error('🚨 SECURITY: Invalid Twilio signature');
      return res.status(403).send('Invalid signature');
    }

    // --- SAFE ZONE: Logic continues ---
    logger.info('✅ Secure message received from Karan', { body: Body.slice(0, 100) });

    const reply = await whatsapp.handleInbound(From, Body);
    
    // Twilio expects a TwiML response or a 200 OK
    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('Webhook error:', { error: error.message });
    res.status(500).send('Error');
  }
});

// ============================================
// ZERODHA AUTH FLOW
// ============================================

/**
 * Step 1: Redirect user to Zerodha login
 * Visit this URL in browser to start daily login
 */
app.get('/api/auth/zerodha/login', async (req, res) => {
  const userId = req.query.user_id as string;
  if (!userId) {
    res.status(400).json({ error: 'user_id required' });
    return;
  }

  const zerodha = new ZerodhaService(userId);
  const loginUrl = zerodha.getLoginUrl();
  res.redirect(loginUrl);
});

/**
 * Step 2: Zerodha redirects back here with request_token
 * This completes the daily authentication
 */
app.get('/api/auth/zerodha/callback', async (req, res) => {
  const requestToken = req.query.request_token as string;
  const userId = req.query.user_id as string || (await getDefaultUserId());

  if (!requestToken) {
    res.status(400).json({ error: 'request_token missing from callback' });
    return;
  }

  try {
    const zerodha = new ZerodhaService(userId);
    await zerodha.authenticate(requestToken);

    // Sync holdings immediately after login
    const count = await zerodha.syncHoldingsToDb();

    res.json({
      success: true,
      message: `Authenticated and synced ${count} holdings`,
      userId,
    });
  } catch (error: any) {
    logger.error('Zerodha auth failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// API ENDPOINTS (for Dashboard)
// ============================================

// Portfolio overview
app.get('/api/portfolio/:userId', async (req, res) => {
  try {
    const data = await portfolio.getFullPortfolio(req.params.userId);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Household portfolio
app.get('/api/portfolio/household/summary', async (_req, res) => {
  try {
    const data = await portfolio.getHouseholdPortfolio();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Market context
app.get('/api/market', async (req, res) => {
  try {
    const phase = (req.query.phase as string) || 'post-open';
    const data = await market.getMarketContext(phase as any);
    res.json({ context: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Recommendations history
app.get('/api/recommendations/:userId', async (req, res) => {
  try {
    const { data } = await db
      .from('recommendations')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit as string) || 50);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Alert history
app.get('/api/alerts/:userId', async (req, res) => {
  try {
    const { data } = await db
      .from('alerts_log')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('sent_at', { ascending: false })
      .limit(parseInt(req.query.limit as string) || 50);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI query from dashboard
app.post('/api/query', async (req, res) => {
  try {
    const { userId, query } = req.body;
    if (!userId || !query) {
      res.status(400).json({ error: 'userId and query required' });
      return;
    }

    const portfolioCtx = await portfolio.buildPortfolioContext(userId);
    const marketCtx = await market.getMarketContext('post-open');
    const analysis = await ai.answerQuery(userId, query, portfolioCtx, marketCtx);
    res.json(analysis);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Manual job trigger (for testing)
app.post('/api/admin/run-job', async (req, res) => {
  try {
    const { jobName } = req.body;
    await runManualJob(jobName);
    res.json({ success: true, job: jobName });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Users list
app.get('/api/users', async (_req, res) => {
  try {
    const users = await db.getAllUsers();
    // Strip sensitive fields
    const safe = users.map((u: any) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      riskProfile: u.risk_profile,
      alertPreferences: u.alert_preferences,
    }));
    res.json(safe);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// CSV import endpoint
app.post('/api/import/csv', async (req, res) => {
  try {
    const { userId, holdings } = req.body;
    // holdings: Array of {name, assetClass, quantity, avgCostPrice, currentPrice, sector?, ...}

    for (const h of holdings) {
      await db.from('holdings').upsert(
        {
          user_id: userId,
          asset_class: h.assetClass || 'other',
          symbol: h.symbol || h.name,
          name: h.name,
          exchange: h.exchange || null,
          sector: h.sector || null,
          quantity: h.quantity,
          avg_cost_price: h.avgCostPrice,
          current_price: h.currentPrice || h.avgCostPrice,
          current_value: (h.currentPrice || h.avgCostPrice) * h.quantity,
          unrealized_pnl: ((h.currentPrice || h.avgCostPrice) - h.avgCostPrice) * h.quantity,
          unrealized_pnl_pct:
            h.avgCostPrice > 0
              ? (((h.currentPrice || h.avgCostPrice) - h.avgCostPrice) / h.avgCostPrice) * 100
              : 0,
          data_source: 'csv_import',
          maturity_date: h.maturityDate || null,
          interest_rate: h.interestRate || null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,symbol,asset_class' }
      );
    }

    res.json({ success: true, count: holdings.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STARTUP
// ============================================

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function getDefaultUserId(): Promise<string> {
  const users = await db.getAllUsers();
  return users[0]?.id || '';
}

async function main() {
  logger.info('WealthPilot starting...', { env: config.env, port: config.port });

  // Start Express server
  app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`);
    logger.info(`WhatsApp webhook: ${config.webhookBaseUrl}/api/webhook/whatsapp`);
    logger.info(`Zerodha login: http://localhost:${config.port}/api/auth/zerodha/login?user_id=YOUR_USER_ID`);
  });

  // Start scheduler
  startScheduler();

  logger.info('WealthPilot fully operational 🚀');
}

main().catch((error) => {
  logger.error('Fatal startup error', { error: error.message });
  process.exit(1);
});
