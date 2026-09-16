import type {
  DocumentState,
  DomainEvent,
  MilestoneCapture,
} from '../types.js';
import type { MilestoneRule, RuleContext } from '../rules/types.js';

export type EngineState = Readonly<{
  mainFrameId: string | null;
  nextDocumentId: number;
  currentDocument: DocumentState | null;
  ruleStates: Readonly<Record<string, any>>;
}>;

/**
 * Pure rules engine orchestrating immutable state transitions across domain events.
 */
export class ModularRulesEngine {
  private state: EngineState;

  constructor(private readonly rules: readonly MilestoneRule[]) {
    this.state = {
      mainFrameId: null,
      nextDocumentId: 0,
      currentDocument: null,
      ruleStates: {},
    };
  }

  public get currentState(): EngineState {
    return this.state;
  }

  public processEvent(event: DomainEvent): readonly MilestoneCapture[] {
    const allCaptures: MilestoneCapture[] = [];

    // 1. If a new main document commits, initialize document state and all rules
    if (event.type === 'committed' && event.isMainFrame) {
      if (
        this.state.currentDocument &&
        this.state.currentDocument.loaderId === event.loaderId
      ) {
        // Redirection or URL update under same loader
        this.state = {
          ...this.state,
          currentDocument: {
            ...this.state.currentDocument,
            url: event.url,
          },
        };
      } else {
        // Evaluate BeforeNavigationRule on departing document before switching
        if (this.state.currentDocument) {
          const rule = this.rules.find((r) => r.id === 'before-navigation');
          if (rule) {
            const rState = this.state.ruleStates[rule.id];
            const result = rule.evaluate(rState, event, {
              currentDocument: this.state.currentDocument,
              lastFrame: this.state.currentDocument.lastFrame,
              currentFrame: null,
            });
            allCaptures.push(...result.captures);
          }
        }

        const nextId = this.state.nextDocumentId + 1;
        const newDoc: DocumentState = {
          id: nextId,
          loaderId: event.loaderId,
          url: event.url,
          firstFrameObserved: false,
          lastFrame: null,
        };

        const initialRuleStates: Record<string, any> = {};
        for (const rule of this.rules) {
          initialRuleStates[rule.id] = rule.init(newDoc);
        }

        this.state = {
          mainFrameId: event.frameId,
          nextDocumentId: nextId,
          currentDocument: newDoc,
          ruleStates: initialRuleStates,
        };

        return allCaptures;
      }
    }

    const currentDoc = this.state.currentDocument;
    if (!currentDoc) {
      return allCaptures;
    }

    const currentFrame = event.type === 'frame' ? event.frame : null;
    const lastFrame = currentDoc.lastFrame;

    const ctx: RuleContext = {
      currentDocument: currentDoc,
      lastFrame,
      currentFrame,
    };

    // 2. Evaluate all rules immutably
    const updatedRuleStates: Record<string, any> = {
      ...this.state.ruleStates,
    };

    for (const rule of this.rules) {
      const rState = updatedRuleStates[rule.id];
      const result = rule.evaluate(rState, event, ctx);
      updatedRuleStates[rule.id] = result.nextState;
      if (result.captures.length > 0) {
        allCaptures.push(...result.captures);
      }
    }

    // 3. Update current document frame tracking
    let updatedDoc = currentDoc;
    if (currentFrame) {
      updatedDoc = {
        ...updatedDoc,
        firstFrameObserved: true,
        lastFrame: currentFrame,
      };
    }

    this.state = {
      ...this.state,
      currentDocument: updatedDoc,
      ruleStates: updatedRuleStates,
    };

    return allCaptures;
  }
}
