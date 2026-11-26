import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseWhaleLabels(rawJson: string | undefined): Record<string, string> {
  if (!rawJson || !rawJson.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === 'string' && typeof v === 'string') {
          normalized[k.trim()] = v.trim();
        }
      }
      return normalized;
    }
    return {};
  } catch {
    console.warn('Warning: WHALE_LABELS_JSON is invalid JSON. Falling back to empty map.');
    return {};
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  heliusApiKey: requireEnv('HELIUS_API_KEY'),
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  telegramChatId: requireEnv('TELEGRAM_CHAT_ID'),
  webhookAuthHeader: requireEnv('WEBHOOK_AUTH_HEADER'),

  minBuyUsd: Number(process.env.MIN_BUY_USD || 1000),
  fallbackSolPriceUsd: Number(process.env.FALLBACK_SOL_PRICE_USD || 180),
  maxRugcheckScore: Number(process.env.MAX_RUGCHECK_SCORE || 500),
  strictRugcheckDangerBlock: (process.env.STRICT_RUGCHECK_DANGER_BLOCK || 'true').toLowerCase() === 'true',

  whaleLabels: parseWhaleLabels(process.env.WHALE_LABELS_JSON),

  n8nWebhookUrl: (process.env.N8N_WEBHOOK_URL || '').trim(),
  jupiterAutoBuyEnabled: (process.env.JUPITER_AUTO_BUY_ENABLED || 'false').toLowerCase() === 'true',

  heliusRpcUrl: `https://mainnet.helius-rpc.com/?api-key=${requireEnv('HELIUS_API_KEY')}`,
  rugCheckBaseUrl: 'https://api.rugcheck.xyz/v1',
};

export const KNOWN_MINTS = {
  SOL_WRAPPED: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const;
