import { unchanged, type MilestoneRule } from '@openuji/engine';
import { DocumentLabel } from './labels.js';

export type FirstFrameState = Readonly<{ saved: boolean }>;

/** Captures the very first visual frame of a new document. */
export const FirstFrameRule: MilestoneRule<FirstFrameState> = {
  id: 'first-frame',
  init: () => ({ saved: false }),
  evaluate: (state, event, { currentDocument, currentFrame }) => {
    if (state.saved || event.type !== 'frame' || !currentFrame) {
      return unchanged(state);
    }

    return {
      nextState: { saved: true },
      captures: [
        {
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: DocumentLabel.first,
          frame: currentFrame,
          detail: 'First visual compositor frame for this document',
        },
      ],
    };
  },
};
