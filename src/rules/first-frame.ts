import type { MilestoneRule } from './types.js';

/** Rule: Captures the very first visual frame of a new document */
export const FirstFrameRule: MilestoneRule<{ saved: boolean }> = {
  id: 'first-frame',
  init: () => ({ saved: false }),
  evaluate: (state, event, { currentDocument, currentFrame }) => {
    if (state.saved || event.type !== 'frame' || !currentFrame) {
      return { nextState: state, captures: [] };
    }

    return {
      nextState: { saved: true },
      captures: [
        {
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: '00-first',
          frame: currentFrame,
          detail: 'First visual compositor frame for this document',
        },
      ],
    };
  },
};
