/**
 * Capture labels the document rules emit. The numeric prefix orders the output
 * filenames; consumers (tests, sinks) should reference these, never the strings.
 */
export const DocumentLabel = {
  first: '00-first',
  domContentLoaded: '01-domcontentloaded',
  settled: '02-settled',
  load: '02-load',
  beforeNavigation: '99-before-navigation',
} as const;
