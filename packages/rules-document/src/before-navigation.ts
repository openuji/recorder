import { unchanged, type MilestoneRule } from '@openuji/engine';
import { DocumentLabel } from './labels.js';

export type BeforeNavigationState = Readonly<{ saved: boolean }>;

/**
 * Captures the final resting visual state before navigating away or ending the
 * session.
 *
 * This is the only rule that fires against a document that is already being
 * replaced, which is why the engine synthesizes a `document-exit` event: it is
 * delivered to every rule while `currentDocument` still refers to the departing
 * document, so `lastFrame` is that document's last visible frame.
 */
export const BeforeNavigationRule: MilestoneRule<BeforeNavigationState> = {
  id: 'before-navigation',
  init: () => ({ saved: false }),
  evaluate: (state, event, { currentDocument, lastFrame }) => {
    if (state.saved || !lastFrame) {
      return unchanged(state);
    }

    if (event.type !== 'document-exit' && event.type !== 'stop') {
      return unchanged(state);
    }

    return {
      nextState: { saved: true },
      captures: [
        {
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: DocumentLabel.beforeNavigation,
          frame: lastFrame,
          detail:
            event.type === 'stop'
              ? 'Session ending; preserving final resting state'
              : `Departing page; next URL is ${event.nextUrl}`,
        },
      ],
    };
  },
};
