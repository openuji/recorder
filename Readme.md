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
[ Host ] ──► CdpTransport ──┬─► [ 1. Compositor  ] ──┐
 Playwright today;          ├─► [ 2. Lifecycle   ] ──┼──► [ Fused Stream ] ──► [ Rules Engine ] ──► [ Sinks ]
 extension, Electron next   └─► [ 3. Interaction ] ──┘      (one FIFO)         (pure reducer)     (console,
                                                                                                 persistence)
```

The app exists to bring **three independent asynchronous streams** together.
Everything right of the host is runtime-agnostic: it sees only a
`CdpTransport` (`send` + `on`), never Playwright, and compiles without Node
types, so the same pipeline can run in Node, Electron's main process, or an
extension service worker. Four properties make it work, and changes must
preserve them:

1. **One FIFO queue.** Every source pushes into a single queue synchronously,
   from inside its CDP event handler, so the order events reach the engine is
   the order they arrived from Chromium — by construction. That ordering *is*
   the fusion — no per-stream buffering, priority or round-robin merging.
2. **"Next frame after X" is load-bearing.** A lifecycle notification says a
   milestone was reached but not what the user can see; the pixels arrive on a
   later frame. Rules arm on a signal and capture the following frame.
3. **`lastFrame` advances after rules run.** That gap is what lets one rule
   capture the resting frame *before* an event while another captures the frame
   *after* it.
4. **One transport, owned by the host.** All three sources attach to the
   transport the host hands out; streams subscribe and unsubscribe but never
   create or close it. Only the host (`RecordingTarget.close()`) ends it.

### Clocks

Arrival order is the only order the pipeline uses; timestamps are diagnostic.
Every frame, lifecycle event and interaction carries `receivedAtMs`, stamped
by the transport when the event arrived — the one clock comparable across
sources. Sources never read a clock themselves; the clock is injected into the
transport, so tests run on a manual one. Source times keep their own clock under their own name: `swapTimeMs`
(Chromium frame swap, epoch ms), `monotonicTime` (Chromium `MonotonicTime`,
seconds from an arbitrary origin) and `pageTimeMs` (the page's clock, epoch ms).
Never subtract one clock from another.

### Attaching to a page that already has a document

The lifecycle source reads the frame tree before enabling lifecycle reporting,
so Chromium's immediate replay of the current document's milestones is
attributed to the right frame. Replayed milestones are tagged `replayed`: the
standalone stream shows them, the fused stream drops them — they describe the
past, and rules must only arm on live signals. The initial `about:blank` of a
fresh page is ignored entirely.

---

## Packages

| Package | Role |
| --- | --- |
| `@openuji/core` | Domain types, the `createPushStream` push-to-pull primitive, the `CaptureSink` contract, base64 frame helpers. Zero deps, isomorphic. |
| `@openuji/cdp` | The `CdpTransport` contract every host implements, the `RecordingTarget` a host hands out, an event router for hosts with one generic event callback, and a fake transport for tests. Isomorphic. |
| `@openuji/client-probe` | The in-page DOM probe: an `installProbe(report)` core plus the CDP-binding entry, bundled by esbuild into an injectable IIFE source string. |
| `@openuji/stream-compositor` | CDP screencast frames. |
| `@openuji/stream-lifecycle` | CDP navigation commits and paint milestones. |
| `@openuji/stream-interaction` | Installs the probe, decodes its binding callbacks. |
| `@openuji/fused` | Orchestrator: three sources on one transport, one ordered `DomainEvent` stream; `startRecording` runs it through the engine into sinks. |
| `@openuji/engine` | `reduce()` — the whole engine as one pure function — plus a thin stateful wrapper. |
| `@openuji/rules-document` | One-shot, `loaderId`-scoped rules, re-initialized per document. |
| `@openuji/rules-interaction` | Repeating numbered episodes carrying DOM target metadata. |
| `@openuji/sinks` | Optional capture destinations: console and PNG + NDJSON persistence. |
| `@openuji/host-playwright` | Playwright-launched Chromium as a host: `launchPlaywrightTarget()`. The only library package that depends on Playwright. |
| `@openuji/cli-kit` | Shared launch, navigation and shutdown scaffolding for the Node CLIs. |
| `@openuji/stream-cli` | Dev runners: each source on its own, and the fused detection pipeline. |
| `@openuji/recorder` | The end-to-end session and its CLI. |

### Sources run alone or fused — same code

Each stream package exports two functions. `attach*` (`attachCompositor`,
`attachLifecycle`, `attachInteraction`) is the source itself: it subscribes to
the transport, sends its enable commands, emits synchronously, and returns a
`detach`. `create*Stream` wraps it in its own push stream so the source runs on
its own — no orchestrator, no engine, no siblings. The fused orchestrator calls
the very same `attach*`, so what a source does in isolation is exactly what it
feeds the fused stream.

```ts
const target = await launchPlaywrightTarget();          // or any other host
const { events, stop } = await createLifecycleStream(target.cdp);   // one source
const recording = await startRecording(target.cdp, { sinks });      // whole pipeline
```

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
pnpm test        # bundle the probe, then vitest against sources — no browser
```

Stream and pipeline tests run on `createFakeCdpTransport()` from
`@openuji/cdp/testing`: script Chromium's events, assert on the commands sent.

Each stream is independently runnable — that is the point of the split. The
runners live in `apps/stream-cli`:

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
on. Frames stay base64 (as CDP sends them) until a sink decodes the few that
are captured. Drops are counted in `stats.dropped` and reported at the end of a session
rather than passing silently.
