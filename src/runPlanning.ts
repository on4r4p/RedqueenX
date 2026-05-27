export function keywordBatchMultiplierFromRunChainCount(runChainCount?: number | null): number {
  const configured = Math.max(0, Math.floor(runChainCount ?? 0));
  if (configured === 0) return 1;
  if (configured === 1) return 2;
  return configured;
}
