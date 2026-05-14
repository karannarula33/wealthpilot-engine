/**
 * Test pipeline — validates each component works
 * Usage: npx tsx scripts/test-pipeline.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭️';

async function test(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    console.log(`${PASS} ${name}`);
    return true;
  } catch (error: any) {
    console.log(`${FAIL} ${name}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🔬 WealthPilot Test Pipeline\n');
  console.log('='.repeat(50));

  let passed = 0;
  let failed = 0;

  // --- 1. Environment Variables ---
  console.log('\n📋 Environment Variables');

  const envVars = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
    'KARAN_PHONE',
  ];

  for (const v of envVars) {
    if (process.env[v]) {
      console.log(`${PASS} ${v}: set`);
      passed++;
    } else {
      console.log(`${FAIL} ${v}: MISSING`);
      failed++;
    }
  }

  // --- 2. Database Connection ---
  console.log('\n🗄️  Database');

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );

  if (await test('Connect to Supabase', async () => {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
  })) passed++; else failed++;

  if (await test('Users table has data', async () => {
    const { data, error } = await supabase.from('users').select('id, name');
    if (error) throw error;
    if (!data?.length) throw new Error('No users found.');
    console.log(`   Found ${data.length} user(s): ${data.map((u: any) => u.name).join(', ')}`);
  })) passed++; else failed++;

  // --- 3. AI Engine ---
  const aiProvider = process.env.AI_PROVIDER || 'anthropic';
  console.log(`\n🤖 AI Engine (Provider: ${aiProvider.toUpperCase()})`);

  if (aiProvider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      console.log(`${FAIL} GEMINI_API_KEY: MISSING`);
      failed++;
    } else {
      if (await test('Gemini API connection & JSON enforcement', async () => {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-2.5-flash',
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = 'You are a financial advisor. Respond ONLY with valid JSON: {"action":"HOLD","conviction":3,"summary":"test","reasoning":"test"}';
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const json = JSON.parse(text);
        if (!json.action) throw new Error('Invalid AI response format');
        console.log(`   AI responded: ${json.action} [${json.conviction}/5]`);
      })) passed++; else failed++;
    }
  } else {
    // Anthropic Testing
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(`${FAIL} ANTHROPIC_API_KEY: MISSING`);
      failed++;
    } else {
      if (await test('Anthropic API connection', async () => {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6-20250514',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Reply with exactly: {"status":"ok"}' }],
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        if (!text.includes('ok')) throw new Error('Unexpected response');
      })) passed++; else failed++;
    }
  }

  // --- 4. Twilio WhatsApp ---
  console.log('\n📱 Twilio WhatsApp');

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    if (await test('Twilio client initialization', async () => {
      const twilio = await import('twilio');
      const client = twilio.default(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
      const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch();
      console.log(`   Account: ${account.friendlyName}`);
    })) passed++; else failed++;

    if (process.env.KARAN_PHONE && !process.env.KARAN_PHONE.includes('X') && process.argv.includes('--send-test')) {
      if (await test('Send test WhatsApp message', async () => {
        const twilio = await import('twilio');
        const client = twilio.default(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
        const msg = await client.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`,
          to: `whatsapp:${process.env.KARAN_PHONE}`,
          body: '🧪 WealthPilot test message — your setup is fully operational with Gemini!',
        });
        console.log(`   Sent! SID: ${msg.sid}`);
      })) passed++; else failed++;
    } else if (process.argv.includes('--send-test')) {
        console.log(`${FAIL} Send test message: Invalid KARAN_PHONE number in .env`);
        failed++;
    } else {
      console.log(`${SKIP} Send test message: add --send-test flag to test`);
    }
  }

  // --- Summary ---
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed! Your setup is ready.');
  } else {
    console.log('\n⚠️  Some tests failed. Fix the issues above before running the server.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);