import { config } from './config.js';
import { AlertPayload } from './types.js';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatNumber(num: number, maxFraction = 4): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFraction,
  }).format(num);
}

export function buildTelegramAlertHtml(payload: AlertPayload): string {
  const { swap, security } = payload;

  const dexScreenerUrl = `https://dexscreener.com/solana/${encodeURIComponent(swap.boughtMint)}`;
  const gmgnUrl = `https://gmgn.ai/sol/token/${encodeURIComponent(swap.boughtMint)}`;
  const solscanTxUrl = `https://solscan.io/tx/${encodeURIComponent(swap.signature)}`;
  const solscanTokenUrl = `https://solscan.io/token/${encodeURIComponent(swap.boughtMint)}`;

  const lines = [
    `🐋 <b>سیگنال خرید نهنگ سولانا (Smart Money Buy)</b>`,
    ``,
    `👤 <b>نهنگ:</b> <code>${escapeHtml(swap.whaleLabel)}</code>`,
    `钱包 <b>آدرس ولت:</b> <code>${escapeHtml(swap.whaleAddress)}</code>`,
    `⚡ <b>مسیر سواپ:</b> <code>${escapeHtml(swap.source)}</code>`,
    ``,
    `💸 <b>مقدار خرج‌شده:</b> <b>${formatNumber(swap.spentAmount, 4)} ${swap.spentAsset}</b> (~$${formatNumber(swap.estimatedUsdValue, 2)})`,
    `🪙 <b>توکن خریداری‌شده:</b> <b>${escapeHtml(security.tokenName)}</b> (<code>$${escapeHtml(security.tokenSymbol)}</code>)`,
    `📦 <b>مقدار دریافتی:</b> <code>${formatNumber(swap.boughtAmount, 4)}</code>`,
    `🔑 <b>کنتراکت توکن (Mint):</b>`,
    `<code>${escapeHtml(swap.boughtMint)}</code>`,
    ``,
    `🛡️ <b>وضعیت امنیتی (Anti-Scam Guard):</b>`,
    `• Mint Authority: <code>null</code> ✅`,
    `• Freeze Authority: <code>null</code> ✅`,
    `• RugCheck Score: <code>${security.rugCheckScore ?? 'N/A'}</code> (Risks: <code>${security.rugCheckRisksCount}</code>) ✅`,
    ``,
    `🔗 <b>لینک‌های تحلیل و بررسی:</b>`,
    `<a href="${dexScreenerUrl}">DexScreener</a> | <a href="${gmgnUrl}">GMGN</a> | <a href="${solscanTokenUrl}">Solscan Token</a> | <a href="${solscanTxUrl}">Tx Hash</a>`,
  ];

  return lines.join('\n').replace('钱包 <b>آدرس ولت:</b>', '👛 <b>آدرس ولت:</b>');
}

export async function sendTelegramAlert(payload: AlertPayload): Promise<void> {
  const htmlMessage = buildTelegramAlertHtml(payload);
  const endpoint = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: htmlMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Telegram sendMessage failed (${response.status}): ${errorBody}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
