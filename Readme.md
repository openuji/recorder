# Chromium Watch (UXR Interaction & Visual Stream Capture)

Captures what a user actually saw and did: Chrome compositor frames, navigation
lifecycle milestones, and in-page DOM interactions — fused into one ordered
event stream, reduced by a pure rules engine into PNG screenshots and an NDJSON
log.

---

## Quick Start

```bash
pnpm install
pnpm start https://my.fu-berlin.de/
```

Interact with the page, then press Ctrl+C. Artifacts land in
`recordings/session-<timestamp>/`.

| Artifact | Meaning |
| --- | --- |
| `interactions.ndjson` | One record per capture: screenshot path, scroll offset, DOM target |
| `nav-00001-00-first.png` | First compositor paint of the document |
| `nav-00001-01-domcontentloaded.png` | Frame following `DOMContentLoaded` |
| `nav-00001-02-settled.png` | Frame following `networkAlmostIdle` |
| `nav-00001-03-pre-scroll-01.png` | Resting frame before scroll episode 1 |
| `nav-00001-04-post-scroll-01.png` | Settled frame after scroll episode 1 |
| `nav-00001-10-pre-click-01.png` | Visual state immediately before click 1 (+ DOM target) |
| `nav-00001-11-post-click-01.png` | Compositor response to click 1 (+ DOM target) |
| `nav-00001-99-before-navigation.png` | Final visible frame before navigating away or ending |

Set `UXR_HEADLESS=1` to run without a visible browser window.

---

## Architecture

```
[ 1. Compositor Stream ] ──┐
[ 2. Lifecycle Stream  ] ──┼──► [ Fused Stream ] ──► [ Rules Engine ] ──► [ Sinks ]
[ 3. Interaction Stream] ──┘      (one FIFO)         (pure reducer)     (console,
         (CDP)                                                        persistence)
```

The app exists to bring **three independent asynchronous streams** together.
Four properties make that work, and changes must preserve them:

1. **One FIFO queue.** All three stream consumers push into a single queue, so
   the order events reach the engine is the order they arrived from Chromium.
   That ordering *is* the fusion — no per-stream buffering, priority or
   round-robin merging.
2. **"Next frame after X" is load-bearing.** A lifecycle notification says a
   milestone was reached but not what the user can see; the pixels arrive on a
   later frame. Rules arm on a signal and capture the following frame.
3. **`lastFrame` advances after rules run.** That gap is what lets one rule
   capture the resting frame *before* an event while another captures the frame
   *after* it.
4. **One shared CDP session.** The orchestrator owns it; each stream detaches
   only a session it created itself.

---

## Packages

| Package | Role |
| --- | --- |
| `@openuji/core` | Domain types, the `createPushStream` push-to-pull primitive, the `CaptureSink` contract, CDP session ownership. Zero deps, isomorphic. |
| `@openuji/client-probe` | The in-page DOM probe. Typechecked TS bundled by esbuild into an injectable IIFE source string. |
| `@openuji/stream-compositor` | CDP screencast frames. |
| `@openuji/stream-lifecycle` | CDP navigation commits and paint milestones. |
| `@openuji/stream-interaction` | Installs the probe, decodes its binding callbacks. |
| `@openuji/fused` | Orchestrator: one CDP session, three streams, one ordered `DomainEvent` stream. |
| `@openuji/engine` | `reduce()` — the whole engine as one pure function — plus a thin stateful wrapper. |
| `@openuji/rules-document` | One-shot, `loaderId`-scoped rules, re-initialized per document. |
| `@openuji/rules-interaction` | Repeating numbered episodes carrying DOM target metadata. |
| `@openuji/sinks` | Optional capture destinations: console and PNG + NDJSON persistence. |
| `@openuji/cli-kit` | Shared browser launch and shutdown scaffolding for the CLIs. |
| `@openuji/recorder` | The end-to-end session and its CLI. |

### Two kinds of rule

They share one interface and nothing else, which is why they are separate
packages:

- **Document rules** fire at most once per document, are scoped to a `loaderId`,
  and are re-initialized whenever a new main-frame document commits. Adding or
  removing a milestone is an entry in an array — see `lifecycleMilestoneRule`.
- **Interaction rules** repeat within a document, number each episode, and tag
  every capture with what the user touched. `scrollLifecycleRule` is a signal
  processor over frame deltas, with tunable thresholds.

---

## Development

```bash
pnpm build       # bundle the probe, then tsc --build across all projects
pnpm typecheck   # everything, browser tier and tests included
pnpm test        # vitest; runs against sources, no build needed
```

Each stream is independently runnable — that is the point of the split:

```bash
pnpm dev:compositor  https://my.fu-berlin.de/   # frame index, latency, scroll offset
pnpm dev:lifecycle   https://my.fu-berlin.de/   # commits, loaderIds, milestones
pnpm dev:interaction https://my.fu-berlin.de/   # clicks and scrollend with DOM metadata
pnpm dev:fused       https://my.fu-berlin.de/   # full detection pipeline, zero disk I/O
```

### Backpressure

Every queue is unbounded by default, matching capture-exact behavior. The
compositor pushes full PNG buffers at up to 60fps, so a stalled consumer grows
memory without limit; pass `maxPendingFrames` to `createCompositorStream` or
`maxPendingEvents` to `createFusedStream` for a ceiling. Only compositor frames
are ever evicted — lifecycle and interaction events are the signals rules arm
on. Drops are counted in `stats.dropped` and reported at the end of a session
rather than passing silently.
