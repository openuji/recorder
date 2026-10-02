export * from './session.js';

export type { CaptureSink, MilestoneCapture } from '@openuji/core';
export { ConsoleSink, PersistenceSink } from '@openuji/sinks';
export { defaultRules, startRecording } from '@openuji/fused';
export type { RecordingHandle, RecordingOptions } from '@openuji/fused';
export { defaultDocumentRules } from '@openuji/rules-document';
export { defaultInteractionRules } from '@openuji/rules-interaction';
