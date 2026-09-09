export function responseIsFinished({
  started,
  complete,
  stop,
  idle = false,
  writing = false,
  visible = true,
  quietForMs = 0,
  fallbackMs = 30_000,
  hiddenCompleteGraceMs = 3_000,
  hiddenFallbackMs = 60_000,
}) {
  if (!started || stop || writing) return false;
  if (complete) return visible || quietForMs >= hiddenCompleteGraceMs;
  const requiredFallbackMs = visible ? fallbackMs : hiddenFallbackMs;
  return Boolean(idle && quietForMs >= requiredFallbackMs);
}
