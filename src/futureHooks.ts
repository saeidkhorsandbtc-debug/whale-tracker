import { config } from './config.js';
import { AlertPayload } from './types.js';

/**
 * نقطه اتصال فاز ۲:
 * ۱) ارسال رویداد تاییدشده به n8n Webhook برای سناریوهای اتوماسیون بیشتر
 * ۲) نقطه اتصال ماژول خرید خودکار با Jupiter Swap API پس از احراز امنیت کامل
 */
export async function triggerPostApprovalHooks(payload: AlertPayload): Promise<void> {
  if (config.n8nWebhookUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'VERIFIED_WHALE_BUY',
          timestamp: new Date().toISOString(),
          data: payload,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      console.error('[Hook:n8n] Failed to forward payload:', err);
    } finally {
      clearTimeout(timer);
    }
  }

  if (config.jupiterAutoBuyEnabled) {
    // Hook نقطه اتصال خرید خودکار Jupiter Swap API (در فاز ۲ پیاده‌سازی می‌شود)
    await executeJupiterAutoBuyStub(payload);
  }
}

export async function executeJupiterAutoBuyStub(payload: AlertPayload): Promise<void> {
  console.log(
    `[JupiterAutoBuy Hook Ready] Target Mint: ${payload.swap.boughtMint} | Whale Spend: $${payload.swap.estimatedUsdValue}`
  );
}
