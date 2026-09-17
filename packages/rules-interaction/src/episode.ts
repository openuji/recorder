/** Two-digit episode suffix shared by all numbered interaction labels. */
export function episodeLabel(prefix: string, episode: number): string {
  return `${prefix}-${String(episode).padStart(2, '0')}`;
}
