import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
  nodeEnv: string; port: number; host: string; dataDir: string; databaseUrl?: string;
  databaseSsl: boolean; publicBaseUrl: string; dashboardOrigin: string; sessionSecret: string;
  setupToken?: string; liveCalls: boolean; liveAI: boolean; openaiApiKey?: string;
  textModel: string; realtimeModel: string; embeddingModel: string; semanticSearch: boolean;
  twilioAccountSid?: string; twilioAuthToken?: string; twilioPhoneNumber?: string;
  twilioRate?: number; aiVoiceRate?: number; aiInputRate?: number; aiOutputRate?: number;
  schedulerEnabled: boolean; schedulerIntervalMs: number; staticDir: string; trustProxy: boolean;
}
function localSecret(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = resolve(dir, name);
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}
function rate(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Pricing estimates must be positive numbers');
  return n;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const dataDir = resolve(env.DATA_DIR || '.data');
  const sessionSecret = env.SESSION_SECRET || (!production ? localSecret(dataDir, 'session-secret') : '');
  const publicBaseUrl = (env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
  const dashboardOrigin = (env.DASHBOARD_ORIGIN || (production ? publicBaseUrl : 'http://localhost:5173')).replace(/\/$/, '');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  if (production && (!env.DATABASE_URL || !publicBaseUrl.startsWith('https://') || !dashboardOrigin.startsWith('https://'))) {
    throw new Error('Production requires DATABASE_URL, an HTTPS PUBLIC_BASE_URL and an HTTPS DASHBOARD_ORIGIN');
  }
  for (const url of [publicBaseUrl, dashboardOrigin]) new URL(url);
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const setupToken = env.SETUP_TOKEN || (!production ? localSecret(dataDir, 'setup-token') : undefined);
  if (setupToken && setupToken.length < 24) throw new Error('SETUP_TOKEN must have at least 24 characters');
  if (env.ENABLE_LIVE_CALLS === 'true' && !production) throw new Error('Live telephone calls require production mode and HTTPS');
  return {
    nodeEnv, port, host: '0.0.0.0', dataDir, databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL === 'true', publicBaseUrl, dashboardOrigin, sessionSecret, setupToken,
    liveCalls: env.ENABLE_LIVE_CALLS === 'true', liveAI: env.ENABLE_LIVE_AI === 'true',
    openaiApiKey: env.OPENAI_API_KEY, textModel: env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
    realtimeModel: env.OPENAI_REALTIME_MODEL || 'gpt-realtime', embeddingModel: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    semanticSearch: env.ENABLE_SEMANTIC_SEARCH === 'true',
    twilioAccountSid: env.TWILIO_ACCOUNT_SID, twilioAuthToken: env.TWILIO_AUTH_TOKEN, twilioPhoneNumber: env.TWILIO_PHONE_NUMBER,
    twilioRate: rate(env.TWILIO_USD_PER_MINUTE), aiVoiceRate: rate(env.AI_VOICE_USD_PER_MINUTE),
    aiInputRate: rate(env.AI_INPUT_USD_PER_MILLION), aiOutputRate: rate(env.AI_OUTPUT_USD_PER_MILLION),
    schedulerEnabled: env.SCHEDULER_ENABLED !== 'false', schedulerIntervalMs: Math.max(1000, Number(env.SCHEDULER_INTERVAL_MS || 15000)),
    staticDir: resolve('dist'), trustProxy: env.TRUST_PROXY === 'true'
  };
}
