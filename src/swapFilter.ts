import { config, KNOWN_MINTS } from './config.js';
import { HeliusEnhancedTransaction, ParsedWhaleBuy } from './types.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

const QUOTE_MINTS = new Set<string>([
  KNOWN_MINTS.SOL_WRAPPED,
  KNOWN_MINTS.USDC,
  KNOWN_MINTS.USDT,
]);

function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getWhaleLabel(address: string): string {
  return config.whaleLabels[address] || `Whale (${shortAddress(address)})`;
}

/**
 * تشخیص می‌کند کدام آدرس در تراکنش SWAP نقش خریدار/نهنگ را دارد و آیا سرمایه واقعی (SOL/USDC/USDT) از آن خارج شده است یا خیر.
 * توکن‌هایی که رایگان وارد ولت می‌شوند یا خروج سرمایه ندارند رد می‌شوند.
 */
export function extractValidWhaleBuy(
  tx: HeliusEnhancedTransaction,
  trackedWallets?: Set<string>
): ParsedWhaleBuy | null {
  if (!tx || !tx.signature) {
    return null;
  }

  // قانون ۲: فقط تراکنش‌های SWAP
  if ((tx.type || '').toUpperCase() !== 'SWAP') {
    return null;
  }

  const tokenTransfers = tx.tokenTransfers || [];
  const nativeTransfers = tx.nativeTransfers || [];

  if (tokenTransfers.length === 0 && nativeTransfers.length === 0) {
    return null;
  }

  // جمع‌آوری خروج‌های توکن از هر حساب
  // key: `${fromUserAccount}:${mint}` -> amount
  const outgoingTokens = new Map<string, number>();
  // جمع‌آوری ورودهای توکن به هر حساب
  // key: `${toUserAccount}:${mint}` -> amount
  const incomingTokens = new Map<string, number>();

  for (const t of tokenTransfers) {
    if (!t.mint || typeof t.tokenAmount !== 'number' || t.tokenAmount <= 0) {
      continue;
    }
    if (t.fromUserAccount) {
      const k = `${t.fromUserAccount}:${t.mint}`;
      outgoingTokens.set(k, (outgoingTokens.get(k) || 0) + t.tokenAmount);
    }
    if (t.toUserAccount) {
      const k = `${t.toUserAccount}:${t.mint}`;
      incomingTokens.set(k, (incomingTokens.get(k) || 0) + t.tokenAmount);
    }
  }

  // جمع‌آوری خروج‌های Native SOL از هر حساب
  const outgoingNativeSol = new Map<string, number>();
  for (const n of nativeTransfers) {
    if (n.fromUserAccount && typeof n.amount === 'number' && n.amount > 0) {
      const solAmt = n.amount / LAMPORTS_PER_SOL;
      outgoingNativeSol.set(
        n.fromUserAccount,
        (outgoingNativeSol.get(n.fromUserAccount) || 0) + solAmt
      );
    }
  }

  // استخراج کاندیدهای ولت (اولویت با ولت‌های مشخص‌شده در trackedWallets اگر موجود باشند)
  const candidateAccounts = new Set<string>();
  for (const t of tokenTransfers) {
    if (t.fromUserAccount) candidateAccounts.add(t.fromUserAccount);
    if (t.toUserAccount) candidateAccounts.add(t.toUserAccount);
  }
  for (const n of nativeTransfers) {
    if (n.fromUserAccount) candidateAccounts.add(n.fromUserAccount);
  }
  if (tx.feePayer) {
    candidateAccounts.add(tx.feePayer);
  }

  for (const account of candidateAccounts) {
    if (trackedWallets && trackedWallets.size > 0 && !trackedWallets.has(account)) {
      continue;
    }

    // بررسی خروج سرمایه واقعی: Native SOL یا wSOL یا USDC یا USDT
    const nativeSolOut = outgoingNativeSol.get(account) || 0;
    const wSolOut = outgoingTokens.get(`${account}:${KNOWN_MINTS.SOL_WRAPPED}`) || 0;
    const usdcOut = outgoingTokens.get(`${account}:${KNOWN_MINTS.USDC}`) || 0;
    const usdtOut = outgoingTokens.get(`${account}:${KNOWN_MINTS.USDT}`) || 0;

    let spentAsset: 'SOL' | 'USDC' | 'USDT' | null = null;
    let spentAmount = 0;
    let estimatedUsdValue = 0;

    const totalSolOut = nativeSolOut + wSolOut;
    if (totalSolOut > 0) {
      spentAsset = 'SOL';
      spentAmount = Number(totalSolOut.toFixed(6));
      estimatedUsdValue = spentAmount * config.fallbackSolPriceUsd;
    } else if (usdcOut > 0) {
      spentAsset = 'USDC';
      spentAmount = Number(usdcOut.toFixed(4));
      estimatedUsdValue = spentAmount;
    } else if (usdtOut > 0) {
      spentAsset = 'USDT';
      spentAmount = Number(usdtOut.toFixed(4));
      estimatedUsdValue = spentAmount;
    }

    // اگر هیچ خروج واقعی SOL/USDC/USDT ثبت نشده باشد، این یک خرید واقعی نیست (مثلاً ایردراپ یا دریافت رایگان است)
    if (!spentAsset || spentAmount <= 0) {
      continue;
    }

    // بررسی حداقل ارزش معامله به دلار
    if (estimatedUsdValue < config.minBuyUsd) {
      continue;
    }

    // پیدا کردن توکن خریداری‌شده (ورودی به همین ولت که جزو توکن‌های مرجع SOL/USDC/USDT نباشد)
    let boughtMint: string | null = null;
    let boughtAmount = 0;

    for (const [key, amt] of incomingTokens.entries()) {
      const [toAcc, mint] = key.split(':');
      if (toAcc === account && !QUOTE_MINTS.has(mint) && amt > boughtAmount) {
        boughtMint = mint;
        boughtAmount = amt;
      }
    }

    if (!boughtMint || boughtAmount <= 0) {
      continue;
    }

    return {
      signature: tx.signature,
      timestamp: tx.timestamp || Math.floor(Date.now() / 1000),
      source: tx.source || 'UNKNOWN_DEX',
      whaleAddress: account,
      whaleLabel: getWhaleLabel(account),
      spentAsset,
      spentAmount,
      estimatedUsdValue: Number(estimatedUsdValue.toFixed(2)),
      boughtMint,
      boughtAmount,
    };
  }

  return null;
}
