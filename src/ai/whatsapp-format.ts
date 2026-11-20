export function normalizeWhatsAppText(text: string): string {
  let normalized = text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');

  const markerIndexes: number[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== '*' || normalized[index - 1] === '\\') continue;
    markerIndexes.push(index);
  }
  if (markerIndexes.length % 2 !== 0) {
    const inlineMarkers = markerIndexes.filter(index => {
      const previous = normalized[index - 1];
      const next = normalized[index + 1];
      return previous !== undefined && next !== undefined &&
        !/\s/.test(previous) && !/\s/.test(next);
    });
    const unmatchedIndex = inlineMarkers[inlineMarkers.length - 1] ??
      markerIndexes[markerIndexes.length - 1];
    normalized = `${normalized.slice(0, unmatchedIndex)}${normalized.slice(unmatchedIndex + 1)}`;
  }
  return normalized;
}
