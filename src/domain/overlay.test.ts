import { describe, expect, it } from 'vitest';
import { overlayUrl } from './overlay';

// What the overlay draws is tested in emblem.test.ts; this module only owns the address.

describe('overlayUrl', () => {
  it('points OBS at the server that serves the app', () => {
    expect(overlayUrl('http://127.0.0.1:5180', 'dl-104')).toBe('http://127.0.0.1:5180/overlay.html?deal=dl-104');
  });

  it('names the kind for every placement but the corner emblem, whose address stays as it was', () => {
    expect(overlayUrl('http://127.0.0.1:5180', 'dl-104', 'emblem')).toBe('http://127.0.0.1:5180/overlay.html?deal=dl-104');
    expect(overlayUrl('http://127.0.0.1:5180', 'dl-104', 'lower-third')).toBe('http://127.0.0.1:5180/overlay.html?deal=dl-104&kind=lower-third');
  });

  it('escapes an id that is not plain', () => {
    expect(overlayUrl('http://127.0.0.1:5180', 'a b&c')).toBe('http://127.0.0.1:5180/overlay.html?deal=a%20b%26c');
  });
});
