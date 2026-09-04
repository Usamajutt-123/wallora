#!/usr/bin/env node
/** Create/update a Supabase-backed WALLORA admin with a salted scrypt hash. */
import { createClient } from '@supabase/supabase-js';
import { scryptSync, randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('❌ Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local first.');
  process.exit(1);
}
try {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error();
} catch {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL must be a credential-free HTTPS URL.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

function askHidden(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal so the password stays hidden.'));
  }
  return new Promise((resolve) => {
    let value = '';
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk) => {
      const char = chunk.toString();
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '\u0003') {
        process.stdin.setRawMode(false);
        process.exit(130);
      } else if (char === '\u007f' || char === '\b') {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char >= ' ') {
        value += char;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

try {
  const username = String(await ask('Username (3-24 lowercase letters/numbers/_): ')).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Invalid username format.');
  const password = String(await askHidden('Password (12-256 characters): '));
  if (password.length < 12 || password.length > 256) throw new Error('Password must contain 12-256 characters.');
  const confirmation = String(await askHidden('Password again: '));
  if (password !== confirmation) throw new Error('Passwords do not match.');

  const salt = randomBytes(16).toString('hex');
  const pass_hash = `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
  const { error } = await supabase.from('admin_users').upsert({ username, pass_hash }, { onConflict: 'username' });
  if (error) throw new Error(`${error.message} (run the audited Supabase SQL first)`);
  console.log(`✅ Admin "${username}" is ready. Sign in at /admin/login.`);
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : 'Could not create admin.'}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
