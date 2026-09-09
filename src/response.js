export function responseIsFinished({
  started,
  complete,
  stop,
  idle = false,
  writing = false,
  quietForMs = 0,
  fallbackMs = 30_000,
}) {
  if (!started || stop || writing) return false;
  return Boolean(complete || (idle && quietForMs >= fallbackMs));
}
