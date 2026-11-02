/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { readDocument, recordingAt, span } from './documents';
import type { Bytes } from './sshsig';
import { assess, expectedKey } from './verify';

const FILES = import.meta.glob<string>('./fixtures/*', { query: '?raw', import: 'default', eager: true });
const file = (name: string): string => FILES[`./fixtures/${name}`] ?? '';
const bytes = (s: string): Bytes => new Uint8Array(new TextEncoder().encode(s));

const ED25519 = 'SHA256:AbRSJ30D/JQ5VqNHm1lI0tlzn8pp6lk26mOj2krpMpw';

describe('assess', () => {
  it('trusts nothing until the key is checked against the agreement, however good the signature', async () => {
    const outcome = await assess({ document: bytes(file('report.json')), signature: file('ed25519.sig'), expected: '', delivered: null });
    expect(outcome.checks.map((c) => [c.label, c.state])).toEqual([
      ['The signature', 'pass'], ['The key, against your agreement', 'warn'], ['The key it names', 'fail'],
    ]);
    expect(outcome.trusted).toBe(false);
  });

  it('trusts a report signed by the agreed key, which names that key', async () => {
    // trusted.json is the airtime report naming the fixture key, signed with it by ssh-keygen.
    const outcome = await assess({ document: bytes(file('trusted.json')), signature: file('trusted.sig'), expected: ED25519, delivered: null });
    expect(outcome.checks.map((c) => [c.label, c.state])).toEqual([
      ['The signature', 'pass'], ['The key, against your agreement', 'pass'], ['The key it names', 'pass'],
    ]);
    expect(outcome.trusted).toBe(true);
  });

  it('does not trust the same report against any other fingerprint', async () => {
    const other = 'SHA256:dFmrCscbn7VRCL/WGm6ImcW6pVXY5Sxb3d+eljYSf1k';
    const outcome = await assess({ document: bytes(file('trusted.json')), signature: file('trusted.sig'), expected: other, delivered: null });
    expect(outcome.trusted).toBe(false);
  });

  it('fails a good signature by a key that is not in the agreement', async () => {
    const outcome = await assess({ document: bytes(file('report.json')), signature: file('ecdsa256.sig'), expected: ED25519, delivered: null });
    const agreement = outcome.checks.find((c) => c.label === 'The key, against your agreement');
    expect(agreement?.state).toBe('fail');
    expect(agreement?.why).toContain('SHA256:dFmrCscbn7VRCL/WGm6ImcW6pVXY5Sxb3d+eljYSf1k');
    expect(outcome.trusted).toBe(false);
  });

  it('fails a document changed after signing', async () => {
    const changed = file('report.json').replace('"totalSeconds":690.0', '"totalSeconds":6900.0');
    const outcome = await assess({ document: bytes(changed), signature: file('ed25519.sig'), expected: ED25519, delivered: null });
    expect(outcome.checks.map((c) => [c.label, c.state])).toEqual([['The signature', 'fail']]);
  });

  it('checks nothing against the key of a signature that does not hold, which is only a claim', async () => {
    const changed = file('trusted.json').replace('"disagreements":1', '"disagreements":0');
    const outcome = await assess({ document: bytes(changed), signature: file('trusted.sig'), expected: ED25519, delivered: null });
    expect(outcome.checks).toHaveLength(1);
    expect(outcome.trusted).toBe(false);
  });

  it('refuses a receipt-namespace signature on a report', async () => {
    const outcome = await assess({ document: bytes(file('report.json')), signature: file('ed25519-receipt-ns.sig'), expected: ED25519, delivered: null });
    expect(outcome.checks[0]?.why).toContain('signed for "sponsifer-receipt"');
  });

  it('notes a security key that signed without a touch, and not one that was touched', async () => {
    const untouched = await assess({ document: bytes(file('report.json')), signature: file('sk-ed25519-no-touch.sig'), expected: '', delivered: null });
    expect(untouched.checks.find((c) => c.label === 'The security key')?.state).toBe('warn');
    const touched = await assess({ document: bytes(file('report.json')), signature: file('sk-ed25519.sig'), expected: '', delivered: null });
    expect(touched.checks.find((c) => c.label === 'The security key')).toBeUndefined();
  });

  it('says plainly when the file is not a Sponsifer document', async () => {
    const outcome = await assess({ document: bytes('{"hello": 1}'), signature: file('ed25519.sig'), expected: '', delivered: null });
    expect(outcome.checks).toEqual([{ label: 'The document', state: 'fail', why: 'This is not a Sponsifer report or licence receipt: it is neither a report nor a licence receipt.' }]);
  });
});

describe('a receipt and the delivered file', () => {
  // receipt.json seals delivered.bin, and is signed by the fixture key under sponsifer-receipt by ssh-keygen.
  const receipt = () => bytes(file('receipt.json'));

  it('trusts a receipt signed by the agreed key, and the file it seals', async () => {
    const outcome = await assess({ document: receipt(), signature: file('receipt.sig'), expected: ED25519, delivered: bytes(file('delivered.bin')) });
    expect(outcome.checks.map((c) => [c.label, c.state])).toEqual([
      ['The signature', 'pass'], ['The key, against your agreement', 'pass'], ['The key it names', 'pass'], ['The delivered file', 'pass'],
    ]);
    expect(outcome.trusted).toBe(true);
  });

  it('fails any other file, however close', async () => {
    const outcome = await assess({ document: receipt(), signature: file('receipt.sig'), expected: ED25519, delivered: bytes('the delivered file ') });
    expect(outcome.checks.find((c) => c.label === 'The delivered file')?.state).toBe('fail');
    expect(outcome.trusted).toBe(false);
  });

  it('refuses a report-namespace signature on a receipt', async () => {
    const outcome = await assess({ document: receipt(), signature: file('ed25519.sig'), expected: ED25519, delivered: null });
    expect(outcome.checks.map((c) => c.why)).toEqual(['Not good: it was signed for "sponsifer-delivery", not "sponsifer-receipt".']);
  });
});

describe('expectedKey', () => {
  it.each([
    [ED25519, ED25519],
    [`The fingerprint in our agreement is ${ED25519}.`, ED25519],
    [file('ed25519.pub'), ED25519],
    [`ada namespaces="sponsifer-delivery" ${file('ed25519.pub').trim()}`, ED25519],
  ])('reads %s', async (input, print) => {
    expect(await expectedKey(input)).toEqual({ kind: 'fingerprint', value: print });
  });

  it('says what it cannot read', async () => {
    expect(await expectedKey('')).toEqual({ kind: 'none' });
    expect(await expectedKey('my key')).toEqual({ kind: 'unreadable' });
    expect(await expectedKey('ssh-ed25519 notbase64!!')).toEqual({ kind: 'unreadable' });
  });
});

describe('documents', () => {
  it('reads the airtime report as one', () => {
    const doc = readDocument(bytes(file('report.json')));
    expect(doc).toMatchObject({ kind: 'airtime-report', label: 'stream-1102', sponsor: null, totalSeconds: 690, disagreements: 1 });
    expect(doc.kind === 'airtime-report' && doc.intervals.map((i) => i.offset)).toEqual([300, 3600]);
  });

  it.each([
    ['https://www.twitch.tv/videos/123', 3725, 'https://www.twitch.tv/videos/123?t=1h2m5s'],
    ['https://www.youtube.com/watch?v=abc', 61, 'https://www.youtube.com/watch?v=abc&t=61s'],
    ['https://youtu.be/abc', 0, 'https://youtu.be/abc?t=0s'],
    ['https://example.com/vod/1', 10, null],
    ['http://www.twitch.tv/videos/123', 10, null],
    ['javascript:alert(1)', 10, null],
    ['', 10, null],
  ])('opens %s at %ss as %s', (url, offset, expected) => {
    expect(recordingAt(url, offset)).toBe(expected);
  });

  it('writes spans as people read them', () => {
    expect([span(9), span(245), span(3723)]).toEqual(['9s', '4m 05s', '1h 02m 03s']);
  });
});
