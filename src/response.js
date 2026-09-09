export function responseIsFinished({ started, complete, stop }) {
  return Boolean(started && complete && !stop);
}
