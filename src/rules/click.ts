import type { MilestoneRule } from './types.js';
import type { TargetElementMeta } from '../types.js';

/** Rule: Captures visual frame immediately BEFORE a user click (+ DOM attributes) */
export const PreClickRule: MilestoneRule<{ clickCount: number }> = {
  id: 'pre-click',
  init: () => ({ clickCount: 0 }),
  evaluate: (state, event, { currentDocument, lastFrame }) => {
    if (
      event.type !== 'interaction' ||
      event.action !== 'click' ||
      !lastFrame
    ) {
      return { nextState: state, captures: [] };
    }

    const clickIndex = state.clickCount + 1;
    const target = event.target;

    return {
      nextState: { clickCount: clickIndex },
      captures: [
        {
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: `10-pre-click-${String(clickIndex).padStart(2, '0')}`,
          frame: lastFrame,
          detail: `Pre-click state on <${target.selector}> "${target.textSnippet ?? ''}"`,
          domTarget: target,
        },
      ],
    };
  },
};

/** Rule: Captures visual frame immediately AFTER a user click (+ DOM attributes) */
export const PostClickRule: MilestoneRule<{
  pendingTarget: TargetElementMeta | null;
  pendingClickIndex: number;
}> = {
  id: 'post-click',
  init: () => ({ pendingTarget: null, pendingClickIndex: 0 }),
  evaluate: (state, event, { currentDocument, currentFrame }) => {
    // 1. Arm on click event
    if (event.type === 'interaction' && event.action === 'click') {
      return {
        nextState: {
          pendingTarget: event.target,
          pendingClickIndex: state.pendingClickIndex + 1,
        },
        captures: [],
      };
    }

    // 2. Fire on next compositor frame
    if (event.type === 'frame' && state.pendingTarget && currentFrame) {
      const target = state.pendingTarget;
      const index = state.pendingClickIndex;

      return {
        nextState: { pendingTarget: null, pendingClickIndex: index },
        captures: [
          {
            documentId: currentDocument.id,
            loaderId: currentDocument.loaderId,
            url: currentDocument.url,
            label: `11-post-click-${String(index).padStart(2, '0')}`,
            frame: currentFrame,
            detail: `Compositor response after clicking <${target.selector}>`,
            domTarget: target,
          },
        ],
      };
    }

    return { nextState: state, captures: [] };
  },
};
