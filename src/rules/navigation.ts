import type { MilestoneRule } from './types.js';

/** Rule: Captures final resting visual state before navigation away or session end */
export const BeforeNavigationRule: MilestoneRule<{ saved: boolean }> = {
  id: 'before-navigation',
  init: () => ({ saved: false }),
  evaluate: (state, event, { currentDocument, lastFrame }) => {
    if (state.saved || !lastFrame) {
      return { nextState: state, captures: [] };
    }

    const isNavigatingAway =
      event.type === 'committed' &&
      event.isMainFrame &&
      event.loaderId !== currentDocument.loaderId;

    const isStopping = event.type === 'stop';

    if (isNavigatingAway || isStopping) {
      return {
        nextState: { saved: true },
        captures: [
          {
            documentId: currentDocument.id,
            loaderId: currentDocument.loaderId,
            url: currentDocument.url,
            label: '99-before-navigation',
            frame: lastFrame,
            detail: isStopping
              ? 'Session ending; preserving final resting state'
              : `Departing page; next URL is ${(event as any).url}`,
          },
        ],
      };
    }

    return { nextState: state, captures: [] };
  },
};
