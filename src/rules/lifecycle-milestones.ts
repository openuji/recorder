import type { MilestoneRule } from './types.js';
import type { MilestoneCapture } from '../types.js';

/** Rule: Captures DOMContentLoaded and load compositor frames */
export const LifecycleMilestonesRule: MilestoneRule<{
  captureDomOnNext: boolean;
  domSaved: boolean;
  captureLoadOnNext: boolean;
  loadSaved: boolean;
  captureNetworkAlmostIdleOnNext: boolean;
  networkAlmostIdleSaved: boolean;
}> = {
  id: 'lifecycle-milestones',
  init: () => ({
    captureDomOnNext: false,
    domSaved: false,
    captureLoadOnNext: false,
    loadSaved: false,
    captureNetworkAlmostIdleOnNext: false,
    networkAlmostIdleSaved: false
  }),
  evaluate: (state, event, { currentDocument, currentFrame }) => {
    // 1. Arm on lifecycle notifications
    if (event.type === 'lifecycle') {
      if (event.loaderId !== currentDocument.loaderId) {
        return { nextState: state, captures: [] };
      }

      if (event.name === 'DOMContentLoaded') {
        return {
          nextState: { ...state, captureDomOnNext: !state.domSaved },
          captures: [],
        };
      }
      // if (event.name === 'load') {
      //   return {
      //     nextState: { ...state, captureLoadOnNext: !state.loadSaved },
      //     captures: [],
      //   };
      // }
      if (event.name === 'networkAlmostIdle') {
        return {
          nextState: { ...state, captureNetworkAlmostIdleOnNext: !state.networkAlmostIdleSaved },
          captures: [],
        };
      }      
    }

    // 2. Fire on subsequent compositor frames
    if (event.type === 'frame' && currentFrame) {
      const captures: MilestoneCapture[] = [];
      let nextState = state;

      if (state.captureDomOnNext && !state.domSaved) {
        captures.push({
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: '01-domcontentloaded',
          frame: currentFrame,
          detail: 'Compositor frame following DOMContentLoaded',
        });
        nextState = { ...nextState, domSaved: true, captureDomOnNext: false };
      }

      // if (state.captureLoadOnNext && !state.loadSaved) {
      //   captures.push({
      //     documentId: currentDocument.id,
      //     loaderId: currentDocument.loaderId,
      //     url: currentDocument.url,
      //     label: '02-load',
      //     frame: currentFrame,
      //     detail: 'Compositor frame following page load',
      //   });
      //   nextState = { ...nextState, loadSaved: true, captureLoadOnNext: false };
      // }

      if (state.captureNetworkAlmostIdleOnNext && !state.networkAlmostIdleSaved) {
        captures.push({
          documentId: currentDocument.id,
          loaderId: currentDocument.loaderId,
          url: currentDocument.url,
          label: '02-settled',
          frame: currentFrame,
          detail: 'Compositor frame following networkAlmostIdle',
        });
        nextState = { ...nextState, networkAlmostIdleSaved: true, captureNetworkAlmostIdleOnNext: false };
      }

      return { nextState, captures };
    }

    return { nextState: state, captures: [] };
  },
};
