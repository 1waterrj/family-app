export function estimateServerOffsetMs(
  serverTime: string,
  clientReceivedAtMs: number,
): number {
  return Date.parse(serverTime) - clientReceivedAtMs;
}

export function remainingSeconds(
  deadline: string,
  clientNowMs: number,
  serverOffsetMs: number,
): number {
  return Math.max(
    0,
    Math.ceil((Date.parse(deadline) - (clientNowMs + serverOffsetMs)) / 1_000),
  );
}
