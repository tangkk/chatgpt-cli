export function responseIsFinished({
  started,
  complete,
  stop,
  idle = false,
  writing = false,
  visible = true,
  quietForMs = 0,
  fallbackMs = 30_000,
}) {
  if (!started || stop || writing || !visible) return false;
  return Boolean(complete || (idle && quietForMs >= fallbackMs));
}
