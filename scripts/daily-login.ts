import { KiteConnect } from 'kiteconnect';
import * as readline from 'readline';
import { ZerodhaService } from '../src/services/data/zerodha';
import { db } from '../src/db/client';
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  const apiKey = process.env.ZERODHA_API_KEY;
  const apiSecret = process.env.ZERODHA_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.error("Missing ZERODHA_API_KEY or ZERODHA_API_SECRET in .env");
    process.exit(1);
  }

  // Find a test user in the DB to attach holdings to
  const { data: users, error: userError } = await db.from('users').select('id, name').limit(1);
  
  if (userError || !users || users.length === 0) {
    console.error("No users found in the database. Please insert a user record first.");
    process.exit(1);
  }

  const testUserId = users[0].id;
  console.log(`Using user: ${users[0].name} (${testUserId})`);

  const kite = new KiteConnect({ api_key: apiKey });
  
  console.log('\n=== Zerodha Manual Login ===');
  console.log('1. Click this link to log in:');
  console.log(kite.getLoginURL());
  console.log('\n2. After logging in, you will be redirected to your redirect URL.');
  console.log('3. Copy the "request_token" parameter from the URL.');
  
  // FIXED: Added strict typing to requestToken
  rl.question('\nPaste the request_token here: ', async (requestToken: string) => {
    try {
      // Correct constructor matching your zerodha.ts file
      const zerodhaService = new ZerodhaService(testUserId, apiKey);

      console.log('Authenticating...');
      // Correct authenticate method matching your zerodha.ts file
      await zerodhaService.authenticate(requestToken.trim(), apiSecret);
      
      console.log('Authentication successful! Syncing holdings to database...');
      await zerodhaService.syncHoldingsToDb();
      
      console.log('Setup complete. You can now close this script.');
    } catch (error) {
      console.error('Error during authentication or sync:', error);
    } finally {
      rl.close();
      process.exit(0);
    }
  });
}

main();