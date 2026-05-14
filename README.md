# WealthPilot

**Personal AI wealth advisor with WhatsApp alerts for Indian household portfolios.**

Monitors your portfolio across Indian equities, mutual funds, ETFs, FDs, US stocks, and gold. Proactively sends high-conviction recommendations via WhatsApp with clear reasoning. Built for a household of two investors with different risk profiles.

## What It Does

- **Morning Prep (8:30 AM)**: Overnight global cues, holdings-specific news, day's agenda
- **Post-Settle Brief (9:45 AM)**: How your portfolio opened, actionable signals with conviction scores
- **Intraday Alerts**: Price breaks, technical signals, news events — only when action is needed
- **Evening Wrap (4:30 PM)**: Day's P&L, recommendation tracking, tomorrow's watch
- **Weekly Digest (Saturday)**: Performance review, accuracy scorecard, next week preview
- **On-demand queries**: Text any question to the WhatsApp bot about your portfolio

Every recommendation includes a conviction score (1-5), specific reasoning with data points, and an educational note so you learn over time.

---

## Quick Start

### Prerequisites

You'll need accounts with:

1. **Supabase** (free tier) — [supabase.com](https://supabase.com) — database
2. **Anthropic** — [console.anthropic.com](https://console.anthropic.com) — Claude AI
3. **Twilio** — [twilio.com](https://www.twilio.com) — WhatsApp messaging
4. **Zerodha Kite Connect** — [developers.kite.trade](https://developers.kite.trade) — portfolio data
5. **Node.js 18+** installed locally

### Step 1: Clone and Install

```bash
git clone <your-repo-url> wealthpilot
cd wealthpilot
npm install
```

### Step 2: Set Up Supabase Database

1. Create a new Supabase project
2. Go to **SQL Editor** in your Supabase dashboard
3. Copy the contents of `src/db/schema.sql` and run it
4. Note your project URL and service key from **Settings → API**

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=+14155238886
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
KARAN_PHONE=+91XXXXXXXXXX
SHUBHANGI_PHONE=+91XXXXXXXXXX
```

### Step 4: Set Up Twilio WhatsApp Sandbox

1. Go to Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. Send the join code from your phone to the sandbox number
3. Note: For production, you'll need a verified WhatsApp Business number

### Step 5: Seed Database

```bash
npx tsx scripts/seed-data.ts
```

This creates your user profiles and sample holdings.

### Step 6: Test Everything

```bash
npx tsx scripts/test-pipeline.ts
```

This validates: database connection, Claude AI, Twilio credentials.

Add `--send-test` to also send a test WhatsApp message:
```bash
npx tsx scripts/test-pipeline.ts --send-test
```

### Step 7: Start the Server

```bash
npx tsx src/index.ts
```

The server starts on port 3000 with:
- WhatsApp webhook: `POST /api/webhook/whatsapp`
- Zerodha login: `GET /api/auth/zerodha/login?user_id=YOUR_ID`
- All scheduled jobs (morning brief, evening wrap, etc.)

### Step 8: Connect Zerodha

1. Visit `http://localhost:3000/api/auth/zerodha/login?user_id=YOUR_USER_ID`
2. Log in to Zerodha
3. You'll be redirected back — holdings are synced automatically
4. **Important**: You need to do this every morning (Zerodha tokens expire daily)

### Step 9: Expose Webhook (for WhatsApp replies)

For local development, use ngrok:
```bash
ngrok http 3000
```

Set the ngrok URL in Twilio Console → WhatsApp Sandbox → Webhook URL:
```
https://your-tunnel.ngrok.io/api/webhook/whatsapp
```

---

## Manual Testing

Trigger any job manually:

```bash
# Morning brief
curl -X POST http://localhost:3000/api/admin/run-job \
  -H "Content-Type: application/json" \
  -d '{"jobName":"morning_prep"}'

# Evening wrap
curl -X POST http://localhost:3000/api/admin/run-job \
  -H "Content-Type: application/json" \
  -d '{"jobName":"evening_wrap"}'

# Available jobs: morning_prep, post_settle, evening_wrap, 
#                 weekly_digest, portfolio_sync, daily_snapshot
```

Query the AI from the API:
```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"userId":"YOUR_ID","query":"Should I hold or sell TCS?"}'
```

---

## Deployment (Railway)

1. Push to GitHub
2. Create a Railway project → link your repo
3. Add all env vars in Railway dashboard
4. Railway auto-deploys on push

Set `WEBHOOK_BASE_URL` to your Railway URL.
Update Twilio webhook to: `https://your-app.railway.app/api/webhook/whatsapp`

Estimated cost: ~₹1,500/month on Railway Starter plan.

---

## Architecture

```
Data Sources → Event Detection → AI Analysis → WhatsApp / Dashboard
     ↓              ↓                ↓              ↓
  Zerodha       Price alerts    Claude Sonnet    Twilio API
  Yahoo Fin     Tech signals    with caching     Rate-limited
  RSS feeds     News monitor    Conviction 1-5   Anti-fatigue
     ↓              ↓                ↓              ↓
              PostgreSQL (Supabase) — single source of truth
```

---

## Cost Estimate

| Component | Monthly Cost |
|-----------|-------------|
| Claude Sonnet API (with caching) | ~₹720 |
| Twilio WhatsApp (India rates) | ~₹280 |
| Railway hosting | ~₹1,500 |
| Zerodha Kite Connect (paid plan) | ₹500 |
| Supabase, Upstash Redis | Free tier |
| **Total** | **~₹3,000/month** |

---

## Project Structure

```
wealthpilot/
├── src/
│   ├── index.ts                 # Express server + startup
│   ├── config.ts                # Environment config
│   ├── db/
│   │   ├── schema.sql           # Full database schema
│   │   └── client.ts            # Supabase client
│   ├── services/
│   │   ├── data/
│   │   │   ├── zerodha.ts       # Kite Connect API
│   │   │   ├── portfolio.ts     # Portfolio aggregator
│   │   │   └── market.ts        # Market data fetcher
│   │   ├── ai/
│   │   │   ├── engine.ts        # Claude API with caching
│   │   │   └── prompts.ts       # System prompts
│   │   ├── whatsapp/
│   │   │   ├── service.ts       # Send/receive messages
│   │   │   └── templates.ts     # Message formatting
│   │   └── scheduler/
│   │       └── index.ts         # Cron jobs
│   ├── utils/
│   │   ├── technical-indicators.ts
│   │   └── logger.ts
│   └── types/
│       └── index.ts
├── scripts/
│   ├── seed-data.ts             # Initialize database
│   └── test-pipeline.ts         # Validate setup
├── .env.example
├── package.json
└── tsconfig.json
```

---

## WhatsApp Commands

Reply to any WealthPilot message with:

| Command | Action |
|---------|--------|
| `DETAILS` | Full analysis of last alert |
| `YES` | Mark recommendation as acted on |
| `SKIP` | Dismiss recommendation |
| `STATUS` | Portfolio snapshot |
| `QUIET` | Pause intraday alerts today |
| `HELP` | List commands |
| *Any text* | Ask AI about your portfolio |

---

## License

Private — built for personal use.
