# Chromium Watch (UXR Interaction & Visual Stream Capture)

A modular, immutable event-driven engine for capturing Chrome visual screencast frames, navigation lifecycle milestones, and user DOM interactions (clicks, scrolling) along with element metadata into an NDJSON log and PNG screenshots.

---

## Quick Start (Complete Recording Mode)

Runs the full session: captures clicks (pre/post), scrolls (pre/post per episode), navigation milestones, writes PNG screenshots, and appends an `interactions.ndjson` log to `recordings/session-<timestamp>/`.

```bash
# Using npm script
npm start https://my.fu-berlin.de/

# Or directly with tsx
npx tsx src/index.ts https://my.fu-berlin.de/
```

### Generated Session Artifacts
Each session outputs to `recordings/session-<timestamp>/`:
* `interactions.ndjson`: Newline Delimited JSON log referencing screenshots and DOM element attributes.
* `nav-00001-00-first.png`: First compositor paint of the document.
* `nav-00001-01-domcontentloaded.png`: Compositor frame following DOMContentLoaded.
* `nav-00001-02-load.png`: Compositor frame following page load.
* `nav-00001-03-pre-scroll-01.png`: Resting frame before scroll episode 1 begins.
* `nav-00001-04-post-scroll-01.png`: Settled frame after scroll episode 1 ends.
* `nav-00001-10-pre-click-01.png`: Visual state immediately before click execution (+ target DOM info).
* `nav-00001-11-post-click-01.png`: Resulting compositor frame following click (+ target DOM info).
* `nav-00001-99-before-navigation.png`: Final visible frame before navigating away or ending session.

---

## Standalone Stream Debug Run Modes

You can run each stream independently in isolation with real-time terminal output:

### 1. Compositor Stream (Visual Frame Metrics)
Streams screencast frames from CDP with instant ACK. Logs frame index, latency, scroll offset, and viewport metrics.
```bash
npm run stream:compositor https://my.fu-berlin.de/
# Or: npx tsx src/streams/compositor.ts https://my.fu-berlin.de/
```

### 2. Lifecycle Stream (Navigation & Paint Milestones)
Streams CDP navigation commits, `loaderId` tracking, monotonic timestamps, `firstPaint`, `DOMContentLoaded`, and `load`.
```bash
npm run stream:lifecycle https://my.fu-berlin.de/
# Or: npx tsx src/streams/lifecycle.ts https://my.fu-berlin.de/
```

### 3. Interaction Stream (In-Page DOM Probe)
Injects an in-page probe via `Runtime.addBinding` (`__uxr_interaction__`). Logs real-time clicks, target selectors, text snippets, and bounding rects.
```bash
npm run stream:interaction https://my.fu-berlin.de/
# Or: npx tsx src/streams/interaction.ts https://my.fu-berlin.de/
```

### 4. Fused Stream (Detection Engine without Disk Writes)
Combines all 3 streams through the pure rules engine and prints live detected milestones in the console without saving any files to disk.
```bash
npm run stream:fused https://my.fu-berlin.de/
# Or: npx tsx src/streams/fused.ts https://my.fu-berlin.de/
```

---

## Architecture Overview

```
[ 1. Compositor Stream ] ──┐
[ 2. Lifecycle Stream  ] ──┼──► [ Fused Domain Stream ] ──► [ Modular Rules Engine ] ──► [ Persistence Sink ]
[ 3. Interaction Stream] ──┘         (multiplexer)             (Pure State Reducer)       (NDJSON + PNG queue)
```

* **`src/types.ts`**: Core domain types (`CompositorFrame`, `LifecycleEvent`, `TargetElementMeta`, `DomainEvent`, `MilestoneCapture`).
* **`src/streams/`**: Independent, pull-based `AsyncIterable` stream adapters.
* **`src/rules/`**: Pluggable milestone rule strategy modules (`FirstFrameRule`, `LifecycleMilestonesRule`, `ScrollLifecycleRule`, `PreClickRule`, `PostClickRule`, `BeforeNavigationRule`).
* **`src/engine/rules-engine.ts`**: Pure reducer state machine.
* **`src/sink/persistence-sink.ts`**: Non-blocking serialized disk writer.
* **`src/app.ts`**: `StreamWatchSession` orchestrator.
* **`src/index.ts`**: Library export root and CLI runner.
