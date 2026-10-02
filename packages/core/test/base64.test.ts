import { describe, expect, it } from 'vitest';
import { base64ByteLength, decodeBase64 } from '../src/base64.js';

describe('decodeBase64', () => {
  it('decodes binary data byte for byte', () => {
    const bytes = [0, 255, 128, 1, 254];
    const encoded = btoa(String.fromCharCode(...bytes));

    expect([...decodeBase64(encoded)]).toEqual(bytes);
  });
});

describe('base64ByteLength', () => {
  it.each([
    ['cG5n', 3],
    ['cG4=', 2],
    ['cA==', 1],
    ['', 0],
  ])('%s decodes to %i bytes', (encoded, expected) => {
    expect(base64ByteLength(encoded)).toBe(expected);
    expect(decodeBase64(encoded).byteLength).toBe(expected);
  });
});
