import Fastify from 'fastify';
import { config } from './config.js';
import { SignatureLruCache } from './cache.js';
import { extractValidWhaleBuy } from './swapFilter.js';
import { runAntiScamGuard } from './antiScam.js';
import { sendTelegramAlert } from './telegram.js';
import { triggerPostApprovalHooks } from './futureHooks.js';
import { HeliusEnhancedTransaction } from './types.js';

const app = Fastify({
  logger: true,
  bodyLimit: 5 * 1024 * 1024, // 5MB
});

const processedSignatures = new SignatureLruCache(20_000);
const trackedWalletSet = new Set<string>(Object.keys(config.whaleLabels));

async function processTransactionsBackground(transactions: HeliusEnhancedTransaction[]): Promise<void> {
  for (const tx of transactions) {
    if (!tx || !tx.signature) {
      continue;
    }

    // قانون ۴: جلوگیری از پردازش تکراری در زمان Retry شدن وب‌هوک توسط Helius
    if (processedSignatures.has(tx.signature)) {
      app.log.info({ signature: tx.signature }, 'Duplicate transaction signature skipped');
      continue;
    }
    processedSignatures.add(tx.signature);

    try {
      // قانون ۲: بررسی SWAP بودن و خروج واقعی SOL/USDC/USDT و حداقل ارزش معامله
      const validBuy = extractValidWhaleBuy(tx, trackedWalletSet);
      if (!validBuy) {
        continue;
      }

      app.log.info(
        {
          signature: validBuy.signature,
          whale: validBuy.whaleAddress,
          mint: validBuy.boughtMint,
          usd: validBuy.estimatedUsdValue,
        },
        'Valid whale buy candidate detected; running Anti-Scam Guard'
      );

      // قانون ۳: بررسی امنیتی توکن (Mint/Freeze == null و RugCheck) با سیاست Fail-Closed
      const security = await runAntiScamGuard(validBuy.boughtMint);
      if (!security.passed) {
        app.log.warn(
          {
            signature: validBuy.signature,
            mint: validBuy.boughtMint,
            reason: security.reason,
          },
          'Token rejected by Anti-Scam Guard (Fail-Closed)'
        );
        continue;
      }

      // ارسال هشدار به تلگرام
      await sendTelegramAlert({ swap: validBuy, security });
      app.log.info(
        {
          signature: validBuy.signature,
          symbol: security.tokenSymbol,
          mint: validBuy.boughtMint,
        },
        'Telegram alert dispatched successfully'
      );

      // هوک‌های فاز ۲ (n8n / Jupiter)
      await triggerPostApprovalHooks({ swap: validBuy, security });
    } catch (err) {
      app.log.error(
        {
          signature: tx.signature,
          err: err instanceof Error ? err.message : String(err),
        },
        'Unexpected error during background transaction processing'
      );
    }
  }
}

app.get('/health', async () => {
  return {
    status: 'ok',
    network: 'solana-mainnet',
    mode: 'event-driven-webhook',
    cachedSignatures: processedSignatures.size(),
  };
});

app.post('/webhook', async (request, reply) => {
  // قانون ۵: اعتبارسنجی هدر احراز هویت وب‌هوک
  const authHeader = request.headers['authorization'];
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  if (!headerValue || headerValue.trim() !== config.webhookAuthHeader) {
    app.log.warn({ ip: request.ip }, 'Unauthorized webhook request attempt');
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  const body = request.body;
  const transactions: HeliusEnhancedTransaction[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? [body as HeliusEnhancedTransaction]
      : [];

  // قانون ۴: پاسخ فوری 200 OK به Helius قبل از اتمام پردازش‌های جانبی
  reply.code(200).send({
    received: true,
    count: transactions.length,
  });

  if (transactions.length > 0) {
    setImmediate(() => {
      void processTransactionsBackground(transactions);
    });
  }
});

async function start(): Promise<void> {
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Solana Whale Tracker Webhook server running on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
