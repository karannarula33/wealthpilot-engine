import cron from 'node-cron';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { db } from '../../db/client';
import { AIEngine } from '../ai/engine';
import { PortfolioService } from '../data/portfolio';
import { MarketDataService } from '../data/market';
import { ZerodhaService } from '../data/zerodha';
import { WhatsAppService } from '../whatsapp/service';
import { formatMorningPrep, formatPostSettle, formatEveningWrap, formatWeeklyDigest, } from '../whatsapp/templates';
import { buildMorningBriefPrompt, buildPostSettleBriefPrompt, buildEveningWrapPrompt, buildWeeklyDigestPrompt, } from '../ai/prompts';
const ai = new AIEngine();
const portfolio = new PortfolioService();
const market = new MarketDataService();
const whatsapp = new WhatsAppService();
/**
 * Start all scheduled jobs
 * All times in IST (Asia/Kolkata)
 */
export function startScheduler() {
    logger.info('Starting scheduler...');
    // --- Morning Prep: 8:30 AM IST, Mon-Fri ---
    cron.schedule('30 8 * * 1-5', () => runJob('morning_prep', morningPrep), {
        timezone: config.timezone,
    });
    // --- Post-Settle Brief: 9:45 AM IST, Mon-Fri ---
    cron.schedule('45 9 * * 1-5', () => runJob('post_settle', postSettleBrief), {
        timezone: config.timezone,
    });
    // --- Evening Wrap: 4:30 PM IST, Mon-Fri ---
    cron.schedule('30 16 * * 1-5', () => runJob('evening_wrap', eveningWrap), {
        timezone: config.timezone,
    });
    // --- Portfolio Sync: Every 2 hrs during market hours (9:30, 11:30, 13:30, 15:30) ---
    cron.schedule('30 9,11,13,15 * * 1-5', () => runJob('portfolio_sync', syncPortfolios), {
        timezone: config.timezone,
    });
    // --- Daily Snapshot: 4:00 PM IST, Mon-Fri ---
    cron.schedule('0 16 * * 1-5', () => runJob('daily_snapshot', takeSnapshots), {
        timezone: config.timezone,
    });
    // --- Weekly Digest: Saturday 10:00 AM IST ---
    cron.schedule('0 10 * * 6', () => runJob('weekly_digest', weeklyDigest), {
        timezone: config.timezone,
    });
    // --- Reset quiet mode: Midnight IST daily ---
    cron.schedule('0 0 * * *', () => runJob('reset_quiet', resetQuietMode), {
        timezone: config.timezone,
    });
    logger.info('All scheduled jobs registered', {
        jobs: [
            'morning_prep (8:30 AM)',
            'post_settle (9:45 AM)',
            'evening_wrap (4:30 PM)',
            'portfolio_sync (every 2h market hours)',
            'daily_snapshot (4:00 PM)',
            'weekly_digest (Sat 10 AM)',
            'reset_quiet (midnight)',
        ],
    });
}
/**
 * Wrapper to run a job with error handling and logging
 */
async function runJob(name, fn) {
    const start = Date.now();
    logger.info(`Job starting: ${name}`);
    try {
        await fn();
        logger.info(`Job complete: ${name}`, { durationMs: Date.now() - start });
    }
    catch (error) {
        logger.error(`Job failed: ${name}`, { error: error.message, stack: error.stack });
    }
}
// --- Job Implementations ---
async function morningPrep() {
    const users = await db.getAllUsers();
    const marketCtx = await market.getMarketContext('pre-market');
    for (const user of users) {
        const portfolioCtx = await portfolio.buildPortfolioContext(user.id);
        const { analysis, recommendationId } = await ai.analyze({
            eventType: 'MORNING_PREP',
            eventContext: buildMorningBriefPrompt(marketCtx),
            portfolioContext: portfolioCtx,
            marketContext: marketCtx,
            userId: user.id,
        });
        const message = formatMorningPrep(analysis, marketCtx);
        await whatsapp.sendMessage(user.id, message, 'morning_prep', recommendationId ? [recommendationId] : []);
    }
}
async function postSettleBrief() {
    const users = await db.getAllUsers();
    const marketCtx = await market.getMarketContext('post-open');
    for (const user of users) {
        // Sync latest from Zerodha before analysis
        await syncUserPortfolio(user);
        const portfolioCtx = await portfolio.buildPortfolioContext(user.id);
        const { analysis, recommendationId } = await ai.analyze({
            eventType: 'POST_SETTLE',
            eventContext: buildPostSettleBriefPrompt(marketCtx),
            portfolioContext: portfolioCtx,
            marketContext: marketCtx,
            userId: user.id,
        });
        const message = formatPostSettle(analysis, portfolioCtx, marketCtx);
        await whatsapp.sendMessage(user.id, message, 'post_settle', recommendationId ? [recommendationId] : []);
    }
}
async function eveningWrap() {
    const users = await db.getAllUsers();
    const marketCtx = await market.getMarketContext('close');
    for (const user of users) {
        await syncUserPortfolio(user);
        const portfolioCtx = await portfolio.buildPortfolioContext(user.id);
        const todayRecs = await db.getTodayRecommendations(user.id);
        const { analysis, recommendationId } = await ai.analyze({
            eventType: 'EVENING_WRAP',
            eventContext: buildEveningWrapPrompt(marketCtx, todayRecs),
            portfolioContext: portfolioCtx,
            marketContext: marketCtx,
            userId: user.id,
        });
        const message = formatEveningWrap(analysis, todayRecs, portfolioCtx);
        await whatsapp.sendMessage(user.id, message, 'evening_wrap', recommendationId ? [recommendationId] : []);
    }
}
async function weeklyDigest() {
    const users = await db.getAllUsers();
    const marketCtx = await market.getMarketContext('close');
    for (const user of users) {
        const portfolioCtx = await portfolio.buildPortfolioContext(user.id);
        const weekRecs = await db.getWeekRecommendations(user.id);
        // Get week performance from snapshots
        const { data: snapshots } = await db
            .from('portfolio_snapshots')
            .select('total_value, snapshot_date')
            .eq('user_id', user.id)
            .order('snapshot_date', { ascending: false })
            .limit(7);
        const weekPerf = {
            startValue: snapshots?.[snapshots.length - 1]?.total_value || 0,
            endValue: snapshots?.[0]?.total_value || 0,
            changePct: 0,
        };
        if (weekPerf.startValue > 0) {
            weekPerf.changePct =
                ((weekPerf.endValue - weekPerf.startValue) / weekPerf.startValue) * 100;
        }
        const { analysis, recommendationId } = await ai.analyze({
            eventType: 'WEEKLY_DIGEST',
            eventContext: buildWeeklyDigestPrompt(marketCtx, weekRecs, weekPerf),
            portfolioContext: portfolioCtx,
            marketContext: marketCtx,
            userId: user.id,
        });
        const message = formatWeeklyDigest(analysis, weekRecs, portfolioCtx, weekPerf);
        await whatsapp.sendMessage(user.id, message, 'weekly_digest', recommendationId ? [recommendationId] : []);
    }
}
async function syncPortfolios() {
    const users = await db.getAllUsers();
    for (const user of users) {
        await syncUserPortfolio(user);
    }
}
async function takeSnapshots() {
    const users = await db.getAllUsers();
    for (const user of users) {
        await portfolio.takeSnapshot(user.id);
    }
}
async function resetQuietMode() {
    const users = await db.getAllUsers();
    for (const user of users) {
        const prefs = { ...(user.alert_preferences || {}), quiet_mode: false };
        await db.from('users').update({ alert_preferences: prefs }).eq('id', user.id);
    }
    logger.info('Quiet mode reset for all users');
}
// --- Helpers ---
async function syncUserPortfolio(user) {
    if (!user.zerodha_api_key)
        return;
    try {
        const zerodha = new ZerodhaService(user.id, user.zerodha_api_key);
        const restored = await zerodha.restoreSession();
        if (restored) {
            await zerodha.syncHoldingsToDb();
        }
        else {
            logger.warn('Zerodha session not available for sync', { userId: user.id });
        }
    }
    catch (error) {
        logger.error('Portfolio sync failed', { userId: user.id, error: error.message });
    }
}
/**
 * Run a specific job manually (for testing)
 */
export async function runManualJob(jobName) {
    const jobs = {
        morning_prep: morningPrep,
        post_settle: postSettleBrief,
        evening_wrap: eveningWrap,
        weekly_digest: weeklyDigest,
        portfolio_sync: syncPortfolios,
        daily_snapshot: takeSnapshots,
    };
    const job = jobs[jobName];
    if (!job) {
        throw new Error(`Unknown job: ${jobName}. Available: ${Object.keys(jobs).join(', ')}`);
    }
    await runJob(jobName, job);
}
