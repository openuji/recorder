/**
 * Label prefixes of the interaction rules; the numeric prefix orders output
 * filenames. Build full labels with {@link episodeLabel}.
 */
export const InteractionLabel = {
  preScroll: '03-pre-scroll',
  postScroll: '04-post-scroll',
  /** A scroll with no scroll input behind it: the page scrolled itself. */
  preAutoScroll: '05-pre-auto-scroll',
  postAutoScroll: '06-post-auto-scroll',
  preClick: '10-pre-click',
  postClick: '11-post-click',
} as const;

/** Two-digit episode suffix shared by all numbered interaction labels. */
export function episodeLabel(prefix: string, episode: number): string {
  return `${prefix}-${String(episode).padStart(2, '0')}`;
}
