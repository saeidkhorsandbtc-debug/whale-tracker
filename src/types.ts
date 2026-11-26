export interface HeliusNativeTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  amount?: number; // in lamports (1 SOL = 1,000,000,000 lamports)
}

export interface HeliusTokenTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  fromTokenAccount?: string;
  toTokenAccount?: string;
  tokenAmount?: number;
  mint?: string;
  tokenStandard?: string;
}

export interface HeliusEnhancedTransaction {
  signature: string;
  timestamp?: number;
  type?: string;
  source?: string;
  fee?: number;
  feePayer?: string;
  description?: string;
  nativeTransfers?: HeliusNativeTransfer[];
  tokenTransfers?: HeliusTokenTransfer[];
  accountData?: Array<{
    account: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: Array<{
      userAccount?: string;
      tokenAccount?: string;
      mint: string;
      rawTokenAmount?: {
        tokenAmount: string;
        decimals: number;
      };
    }>;
  }>;
}

export interface ParsedWhaleBuy {
  signature: string;
  timestamp: number;
  source: string;
  whaleAddress: string;
  whaleLabel: string;
  spentAsset: 'SOL' | 'USDC' | 'USDT';
  spentAmount: number;
  estimatedUsdValue: number;
  boughtMint: string;
  boughtAmount: number;
}

export interface SecurityCheckResult {
  passed: boolean;
  reason?: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  rugCheckScore: number | null;
  rugCheckRisksCount: number;
  rugCheckTopRisk: string;
  isRugged: boolean;
}

export interface AlertPayload {
  swap: ParsedWhaleBuy;
  security: SecurityCheckResult;
}
