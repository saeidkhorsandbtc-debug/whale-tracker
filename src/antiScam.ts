import { config } from './config.js';
import { SecurityCheckResult } from './types.js';

interface DasGetAssetResponse {
  result?: {
    id?: string;
    content?: {
      metadata?: {
        name?: string;
        symbol?: string;
      };
    };
    token_info?: {
      decimals?: number;
      mint_authority?: string | null;
      freeze_authority?: string | null;
    };
    authorities?: Array<{
      address?: string;
      scopes?: string[];
    }>;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

interface RugCheckRiskItem {
  name?: string;
  level?: string;
  description?: string;
  score?: number;
}

interface RugCheckSummaryResponse {
  score?: number;
  score_normalised?: number;
  rugged?: boolean;
  risks?: RugCheckRiskItem[];
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * بررسی امنیتی توکن با اصل Fail-Closed:
 * در صورت بروز هرگونه خطای شبکه، نامعتبر بودن پاسخ یا وجود ریسک امنیتی، passed = false برمی‌گرداند.
 */
export async function runAntiScamGuard(mintAddress: string): Promise<SecurityCheckResult> {
  const failedBase: SecurityCheckResult = {
    passed: false,
    reason: 'خطای نامشخص در استعلام امنیتی',
    mintAuthority: 'UNKNOWN',
    freezeAuthority: 'UNKNOWN',
    tokenName: 'Unknown Token',
    tokenSymbol: 'UNKNOWN',
    decimals: 0,
    rugCheckScore: null,
    rugCheckRisksCount: 0,
    rugCheckTopRisk: 'N/A',
    isRugged: false,
  };

  try {
    // ۱. استعلام متادیتا و مجوزها از Helius DAS API (getAsset)
    const dasResponse = await fetchWithTimeout(config.heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'whale-guard-get-asset',
        method: 'getAsset',
        params: {
          id: mintAddress,
          options: {
            showFungible: true,
          },
        },
      }),
    });

    if (!dasResponse.ok) {
      return {
        ...failedBase,
        reason: `خطای HTTP در Helius DAS API: ${dasResponse.status}`,
      };
    }

    const dasJson = (await dasResponse.json()) as DasGetAssetResponse;
    if (dasJson.error || !dasJson.result) {
      return {
        ...failedBase,
        reason: `پاسخ نامعتبر از Helius DAS API: ${dasJson.error?.message || 'empty result'}`,
      };
    }

    const asset = dasJson.result;
    const tokenName = asset.content?.metadata?.name?.trim() || 'Unknown';
    const tokenSymbol = asset.content?.metadata?.symbol?.trim() || 'TOKEN';
    const decimals = Number(asset.token_info?.decimals ?? 0);

    // استخراج mintAuthority و freezeAuthority از token_info یا authorities
    let mintAuthority: string | null =
      asset.token_info?.mint_authority !== undefined ? asset.token_info.mint_authority : null;
    let freezeAuthority: string | null =
      asset.token_info?.freeze_authority !== undefined ? asset.token_info.freeze_authority : null;

    if (Array.isArray(asset.authorities)) {
      const hasMintAuth = asset.authorities.some((a) => a.scopes?.includes('mint'));
      const hasFreezeAuth = asset.authorities.some((a) => a.scopes?.includes('freeze'));
      if (hasMintAuth && !mintAuthority) {
        mintAuthority = asset.authorities.find((a) => a.scopes?.includes('mint'))?.address || 'ACTIVE';
      }
      if (hasFreezeAuth && !freezeAuthority) {
        freezeAuthority =
          asset.authorities.find((a) => a.scopes?.includes('freeze'))?.address || 'ACTIVE';
      }
    }

    // قانون ۳: Mint Authority و Freeze Authority هر دو باید null باشند
    if (mintAuthority !== null) {
      return {
        ...failedBase,
        tokenName,
        tokenSymbol,
        decimals,
        mintAuthority,
        freezeAuthority,
        reason: `Mint Authority فعال است (${mintAuthority})`,
      };
    }

    if (freezeAuthority !== null) {
      return {
        ...failedBase,
        tokenName,
        tokenSymbol,
        decimals,
        mintAuthority,
        freezeAuthority,
        reason: `Freeze Authority فعال است (${freezeAuthority})`,
      };
    }

    // ۲. استعلام امتیاز و ریسک از RugCheck API
    const rugUrl = `${config.rugCheckBaseUrl}/tokens/${encodeURIComponent(mintAddress)}/report/summary`;
    const rugResponse = await fetchWithTimeout(rugUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!rugResponse.ok) {
      return {
        ...failedBase,
        tokenName,
        tokenSymbol,
        decimals,
        mintAuthority: null,
        freezeAuthority: null,
        reason: `خطای HTTP در RugCheck API: ${rugResponse.status}`,
      };
    }

    const rugJson = (await rugResponse.json()) as RugCheckSummaryResponse;
    const score = typeof rugJson.score === 'number' ? rugJson.score : null;
    const isRugged = Boolean(rugJson.rugged);
    const risks = Array.isArray(rugJson.risks) ? rugJson.risks : [];

    if (score === null) {
      return {
        ...failedBase,
        tokenName,
        tokenSymbol,
        decimals,
        mintAuthority: null,
        freezeAuthority: null,
        reason: 'امتیاز RugCheck در پاسخ موجود نیست (Fail-Closed)',
      };
    }

    if (isRugged) {
      return {
        ...failedBase,
        tokenName,
        tokenSymbol,
        decimals,
        mintAuthority: null,
        freezeAuthority: null,
        rugCheckScore: score,
        rugCheckRisksCount: risks.length,
        rugCheckTopRisk: 'Token marked as RUGGED',
        isRugged: true,
        reason: 'توکن توسط RugCheck به‌عنوان Rugged علامت‌گذاری شده است',
      };
    }

    if (score > config.maxRugcheckScore) {
      const topRiskName = risks[0]?.name || 'High Risk Score';
      return {
        ...failedBase,
        tokenName,
        tokenSymbol,
        decimals,
        mintAuthority: null,
        freezeAuthority: null,
        rugCheckScore: score,
        rugCheckRisksCount: risks.length,
        rugCheckTopRisk: topRiskName,
        isRugged: false,
        reason: `امتیاز ریسک RugCheck (${score}) بیشتر از حد مجاز (${config.maxRugcheckScore}) است`,
      };
    }

    const hasDangerRisk = risks.some((r) => (r.level || '').toLowerCase() === 'danger');
    if (config.strictRugcheckDangerBlock && hasDangerRisk) {
      const dangerRisk = risks.find((r) => (r.level || '').toLowerCase() === 'danger');
      return {
        ...failedBase,
        tokenName,
        tokenSymbol,
        decimals,
        mintAuthority: null,
        freezeAuthority: null,
        rugCheckScore: score,
        rugCheckRisksCount: risks.length,
        rugCheckTopRisk: dangerRisk?.name || 'DANGER',
        isRugged: false,
        reason: `ریسک سطح DANGER در RugCheck شناسایی شد: ${dangerRisk?.name || 'Unknown'}`,
      };
    }

    const topRisk = risks[0]?.name || 'None';

    return {
      passed: true,
      mintAuthority: null,
      freezeAuthority: null,
      tokenName,
      tokenSymbol,
      decimals,
      rugCheckScore: score,
      rugCheckRisksCount: risks.length,
      rugCheckTopRisk: topRisk,
      isRugged: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...failedBase,
      reason: `استثنا در اجرای Anti-Scam Guard (Fail-Closed): ${message}`,
    };
  }
}
