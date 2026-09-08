#!/usr/bin/env node
/**
 * 🔑 Pinterest OAuth bootstrap — run ONCE to get your refresh token.
 *
 * Steps:
 *   1. Go to https://developers.pinterest.com → create/configure an app with
 *      the access level Pinterest requires for your account and intended use.
 *   2. In app settings → redirect URIs → add:  http://localhost:3333/callback
 *   3. Put PINTEREST_CLIENT_ID + PINTEREST_CLIENT_SECRET in .env.local
 *   4. Run:  node scripts/pinterest-auth.js
 *   5. Browser opens → approve → it prints your PINTEREST_REFRESH_TOKEN
 *   6. Paste that into .env.local (and Vercel env vars) — done, auto-pins on!
 *
 * Scopes requested: boards:read pins:write  (we only pin to YOUR boards)
 */

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true });
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const CLIENT_ID = process.env.PINTEREST_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET || '';
const REDIRECT = 'http://localhost:3333/callback';
const SCOPES = 'boards:read,pins:write';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Set PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET in .env.local first');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl =
  'https://www.pinterest.com/oauth/?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPES,
    state,
  }).toString();

console.log('\n1️⃣  If the browser does not open by itself, open this link:\n   ' + authUrl + '\n');
const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', authUrl]] : process.platform === 'darwin' ? ['open', [authUrl]] : ['xdg-open', [authUrl]];
spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).on('error', () => {});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('state') !== state) {
    res.end('Invalid state / no code.');
    return;
  }
  res.end('Authorization received. Check the terminal.');

  try {
    const response = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
      signal: AbortSignal.timeout(20_000),
    });
    const tok = await response.json().catch(() => ({}));
    if (!response.ok || typeof tok.refresh_token !== 'string' || !tok.refresh_token) {
      console.log(`❌ Token exchange failed (HTTP ${response.status}). Pinterest did not return a refresh token.`);
      process.exit(1);
    }
    console.log('\n✅ SUCCESS! Paste this line into .env.local:\n');
    console.log(`PINTEREST_REFRESH_TOKEN=${tok.refresh_token}`);
    console.log(`# PINTEREST_BOARD=WALLORA   (optional — default = your first board)\n`);
    console.log('The daily cron can now pin new wallpapers to Pinterest. 📌');
    process.exit(0);
  } catch (error) {
    console.log(`❌ Token exchange failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exit(1);
  }
});

server.on('error', (error) => {
  console.error(`❌ Local callback server failed to start: ${error.message}`);
  process.exit(1);
});
server.listen(3333, 'localhost', () => console.log('⏳ Waiting for Pinterest approval on http://localhost:3333 …'));
setTimeout(() => { console.log('⏰ timeout 3min — please try again'); process.exit(1); }, 180_000);
