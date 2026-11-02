/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { fingerprint, keyBlob, verifySignature } from './sshsig';

/**
 * Every fixture was signed by the real ssh-keygen (OpenSSH 10.5) over the
 * airtime-report golden file, and checked by OpenSSH 9.5 as well. The sk-
 * fixtures follow PROTOCOL.u2f with software keys, and both ssh-keygen builds
 * accept them. This page must agree with ssh-keygen on every one.
 */

const FILES = import.meta.glob<string>('./fixtures/*', { query: '?raw', import: 'default', eager: true });
const file = (name: string): string => {
  const content = FILES[`./fixtures/${name}`];
  if (content === undefined) throw new Error(`no fixture ${name}`);
  return content;
};
const MESSAGE = new Uint8Array(new TextEncoder().encode(file('report.json')));
const DELIVERY = 'sponsifer-delivery';

/** What ssh-keygen printed for each, from both builds. */
const SSH_KEYGEN: Record<string, [type: string, fingerprint: string, touched: boolean | null]> = {
  ed25519: ['ssh-ed25519', 'SHA256:AbRSJ30D/JQ5VqNHm1lI0tlzn8pp6lk26mOj2krpMpw', null],
  ecdsa256: ['ecdsa-sha2-nistp256', 'SHA256:dFmrCscbn7VRCL/WGm6ImcW6pVXY5Sxb3d+eljYSf1k', null],
  ecdsa384: ['ecdsa-sha2-nistp384', 'SHA256:AvD1DecaOq2yIB0GbTDngf7rmOLjrZPqkvYfrztqxaE', null],
  ecdsa521: ['ecdsa-sha2-nistp521', 'SHA256:PkY9IEl5sgTZ0mZ0lLBz4X3EoguTyq+7wgK1O8bPBGI', null],
  rsa3072: ['ssh-rsa', 'SHA256:NBxoqBpYj2AmTOFR6eHNiXEdWlhevZVr+IdKgbTkxsY', null],
  'rsa-sha256': ['ssh-rsa', 'SHA256:PncoHaH506dEF7o9OPsZ/lDgBd3Hi5f5cLs4uRbDyrg', null],
  'sk-ed25519': ['sk-ssh-ed25519@openssh.com', 'SHA256:Au2BDl5S8EUGWuNKQRZTinwzBbHyifHJFyIQhLUfmww', true],
  'sk-ed25519-no-touch': ['sk-ssh-ed25519@openssh.com', 'SHA256:9stWgQUkVen51gZHTwa04kdxgVgGsQAWB97RVy5E9p4', false],
  'sk-ecdsa256': ['sk-ecdsa-sha2-nistp256@openssh.com', 'SHA256:M7w8/2AwUyaPS6aOuuMMef60r7OBGu2VGhFUXreTd6k', true],
  'sk-ecdsa256-no-touch': ['sk-ecdsa-sha2-nistp256@openssh.com', 'SHA256:4Mq1pUtEIKPqD6ftLXwJOIOgn5nKYaVvdtNfRKXaL3Q', false],
};

describe.each(Object.entries(SSH_KEYGEN))('%s', (name, [type, print, touched]) => {
  it('is good where ssh-keygen says good, with the same key and fingerprint', async () => {
    const verdict = await verifySignature(file(`${name}.sig`), MESSAGE, DELIVERY);
    expect(verdict).toMatchObject({ kind: 'valid', keyType: type, fingerprint: print, namespace: DELIVERY, touched });
    if (verdict.kind === 'valid') expect(verdict.publicKey).toBe(file(`${name}.pub`).trim());
  });

  it('fails for a single changed byte', async () => {
    const changed = MESSAGE.slice();
    const at = changed.length - 2;
    changed[at] = (changed[at] ?? 0) ^ 1;
    expect((await verifySignature(file(`${name}.sig`), changed, DELIVERY)).kind).toBe('invalid');
  });

  it("computes ssh-keygen's fingerprint from the public key", async () => {
    expect(await fingerprint(keyBlob(file(`${name}.pub`)))).toBe(print);
  });
});

describe('what it refuses', () => {
  it('a signature made for another namespace, so a receipt signature never passes as a report', async () => {
    const verdict = await verifySignature(file('ed25519-receipt-ns.sig'), MESSAGE, DELIVERY);
    expect(verdict).toMatchObject({ kind: 'invalid', fingerprint: SSH_KEYGEN.ed25519?.[1] });
    expect(verdict.kind === 'invalid' && verdict.reason).toBe('it was signed for "sponsifer-receipt", not "sponsifer-delivery"');
    expect((await verifySignature(file('ed25519-receipt-ns.sig'), MESSAGE, 'sponsifer-receipt')).kind).toBe('valid');
  });

  it('anything that is not an armoured SSH signature', async () => {
    for (const junk of ['', 'hello', '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----', file('ed25519.pub')]) {
      expect((await verifySignature(junk, MESSAGE, DELIVERY)).kind).toBe('invalid');
    }
  });

  it('a public key line whose type does not match its data', () => {
    const [, data] = file('ed25519.pub').split(' ');
    expect(() => keyBlob(`ssh-rsa ${data ?? ''}`)).toThrow('does not match');
  });

  it('a signature cut short', async () => {
    const lines = file('ecdsa256.sig').trim().split(/\r?\n/);
    const cut = [lines[0], (lines[1] ?? '').slice(0, 40), lines[lines.length - 1]].join('\n');
    expect(await verifySignature(cut, MESSAGE, DELIVERY)).toMatchObject({ kind: 'invalid' });
  });
});
