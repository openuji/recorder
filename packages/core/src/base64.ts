/**
 * Base64 helpers for compositor frames.
 *
 * Frames arrive at up to 60fps but only a handful are ever captured, so they
 * stay base64 until a sink needs the bytes. Both helpers avoid `Buffer`: `atob`
 * exists in Node, browsers and extension service workers alike.
 */

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decoded size of a base64 string, without decoding it. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
