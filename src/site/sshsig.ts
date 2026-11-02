/**
 * OpenSSH signatures (SSHSIG), checked in the browser with WebCrypto alone.
 *
 * A sponsor receives a report and its `.sig`, signed by `ssh-keygen -Y sign`.
 * This checks the signature as `ssh-keygen -Y check-novalidate` would, for
 * every key type ssh-keygen signs with: Ed25519, ECDSA on P-256, P-384 and
 * P-521, RSA, and the FIDO security-key types sk-ssh-ed25519 and
 * sk-ecdsa-sha2-nistp256. Nothing is uploaded and no library is loaded.
 *
 * The rule: this page and ssh-keygen never disagree about a signature. The
 * fixtures were made by the real ssh-keygen (OpenSSH 10.5) and checked by
 * OpenSSH 9.5 as well; `sshsig.test.ts` holds this file to them. Like
 * ssh-keygen, a security-key signature made without a touch is accepted,
 * and the verdict says so.
 *
 * Formats: OpenSSH PROTOCOL.sshsig, PROTOCOL.u2f, RFC 4253 and RFC 5656.
 * `python/sponsifer/sshsig.py` is the signer's side.
 */

/** Bytes WebCrypto accepts: a view over an ordinary ArrayBuffer, never a shared one. */
export type Bytes = Uint8Array<ArrayBuffer>;

export type KeyType =
  | 'ssh-ed25519'
  | 'ecdsa-sha2-nistp256'
  | 'ecdsa-sha2-nistp384'
  | 'ecdsa-sha2-nistp521'
  | 'ssh-rsa'
  | 'sk-ssh-ed25519@openssh.com'
  | 'sk-ecdsa-sha2-nistp256@openssh.com';

export type Verdict =
  | { kind: 'valid'; keyType: KeyType; publicKey: string; fingerprint: string; namespace: string; touched: boolean | null }
  | { kind: 'invalid'; reason: string; publicKey: string | null; fingerprint: string | null }
  | { kind: 'unsupported'; reason: string };

const BEGIN = '-----BEGIN SSH SIGNATURE-----';
const END = '-----END SSH SIGNATURE-----';
const MAGIC = 'SSHSIG';
const text = new TextEncoder();

class Malformed extends Error {}

/** Reads SSH wire-format fields in order (RFC 4251 section 5). */
class Reader {
  private pos = 0;

  constructor(private readonly data: Bytes) {}

  raw(n: number): Bytes {
    if (this.pos + n > this.data.length) throw new Malformed('a truncated SSH structure');
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  byte(): number {
    return this.raw(1)[0] ?? 0;
  }

  uint32(): number {
    const b = this.raw(4);
    return (((b[0] ?? 0) << 24) >>> 0) + ((b[1] ?? 0) << 16) + ((b[2] ?? 0) << 8) + (b[3] ?? 0);
  }

  string(): Bytes {
    return this.raw(this.uint32());
  }

  utf8(): string {
    return new TextDecoder().decode(this.string());
  }
}

function concat(...parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sshString(bytes: Bytes): Bytes {
  const n = bytes.length;
  return concat(new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]), bytes);
}

function base64(bytes: Bytes): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unbase64(value: string): Bytes {
  const s = atob(value);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** The base64url form JWK wants, from big-endian bytes with any leading zeros dropped. */
function base64url(bytes: Bytes): string {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  return base64(bytes.subarray(start)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The binary blob inside an armoured signature. */
export function unarmour(armoured: string): Bytes {
  const lines = armoured.trim().split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== BEGIN || lines[lines.length - 1] !== END) throw new Malformed('not an SSH signature');
  return unbase64(lines.slice(1, -1).join(''));
}

/** "type base64", the OpenSSH public key line without a comment. */
export function publicKeyLine(blob: Bytes): string {
  return `${new Reader(blob).utf8()} ${base64(blob)}`;
}

/** A public key line's wire blob, checked against the type it claims. */
export function keyBlob(line: string): Bytes {
  const [type, data] = line.trim().split(/\s+/);
  if (!type || !data) throw new Malformed('not an OpenSSH public key line');
  const blob = unbase64(data);
  if (new Reader(blob).utf8() !== type) throw new Malformed('the public key type does not match its data');
  return blob;
}

/** The SHA256 fingerprint exactly as `ssh-keygen -l` and GitHub display it. */
export async function fingerprint(blob: Bytes, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', blob));
  return `SHA256:${base64(digest).replace(/=+$/, '')}`;
}

interface Parsed {
  publicKey: Bytes;
  namespace: string;
  hashAlg: string;
  signature: Bytes;
}

function parse(blob: Bytes): Parsed {
  const r = new Reader(blob);
  if (new TextDecoder().decode(r.raw(6)) !== MAGIC || r.uint32() !== 1) throw new Malformed('an unsupported SSH signature version');
  const publicKey = r.string();
  const namespace = r.utf8();
  r.string(); // reserved
  return { publicKey, namespace, hashAlg: r.utf8(), signature: r.string() };
}

/** The bytes the key actually signed: PROTOCOL.sshsig's signed-data blob. */
async function signedData(message: Bytes, namespace: string, hashAlg: string, subtle: SubtleCrypto): Promise<Bytes> {
  const digest = new Uint8Array(await subtle.digest(hashAlg === 'sha256' ? 'SHA-256' : 'SHA-512', message));
  return concat(text.encode(MAGIC), sshString(text.encode(namespace)), sshString(new Uint8Array()),
    sshString(text.encode(hashAlg)), sshString(digest));
}

const CURVES = {
  nistp256: { name: 'P-256', hash: 'SHA-256', size: 32 },
  nistp384: { name: 'P-384', hash: 'SHA-384', size: 48 },
  nistp521: { name: 'P-521', hash: 'SHA-512', size: 66 },
} as const;

type Curve = keyof typeof CURVES;

/** An SSH ECDSA signature (mpint r, mpint s) as WebCrypto's fixed-width r || s. */
function ecdsaSignature(blob: Bytes, size: number): Bytes {
  const r = new Reader(blob);
  const fixed = (n: Bytes) => {
    const trimmed = n.subarray(Math.max(0, n.length - size));
    if (n.length > size && n.subarray(0, n.length - size).some((b) => b !== 0)) throw new Malformed('an ECDSA value too large for its curve');
    return concat(new Uint8Array(size - trimmed.length), trimmed);
  };
  return concat(fixed(r.string()), fixed(r.string()));
}

/** Whether `signature` is `key`'s, over `data`. Throws Malformed on a structure that does not parse. */
type Check = (key: Reader, signature: Reader, data: Bytes, subtle: SubtleCrypto) => Promise<{ ok: boolean; touched: boolean | null }>;

const ed25519: Check = async (key, signature, data, subtle) => {
  const k = await subtle.importKey('raw', key.string(), { name: 'Ed25519' }, false, ['verify']);
  return { ok: await subtle.verify({ name: 'Ed25519' }, k, signature.string(), data), touched: null };
};

function ecdsa(expected: Curve): Check {
  return async (key, signature, data, subtle) => {
    const curve = CURVES[expected];
    if (key.utf8() !== expected) throw new Malformed('an ECDSA key on the wrong curve');
    const k = await subtle.importKey('raw', key.string(), { name: 'ECDSA', namedCurve: curve.name }, false, ['verify']);
    const sig = ecdsaSignature(signature.string(), curve.size);
    return { ok: await subtle.verify({ name: 'ECDSA', hash: curve.hash }, k, sig, data), touched: null };
  };
}

const RSA_HASHES: Readonly<Record<string, string>> = { 'rsa-sha2-256': 'SHA-256', 'rsa-sha2-512': 'SHA-512' };

/** RSA, whose signature names its own hash. ssh-keygen signs with rsa-sha2-512; plain ssh-rsa (SHA-1) is refused, as OpenSSH refuses it. */
async function rsa(key: Reader, sigType: string, signature: Reader, data: Bytes, subtle: SubtleCrypto) {
  const hash = RSA_HASHES[sigType];
  if (!hash) throw new Malformed(`an RSA signature of type ${sigType}, which OpenSSH no longer accepts`);
  const e = key.string();
  const n = key.string();
  const jwk = { kty: 'RSA', e: base64url(e), n: base64url(n), ext: true };
  const k = await subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  return { ok: await subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, k, signature.string(), data), touched: null };
}

/**
 * A FIDO security key signs SHA256(application) || flags || counter ||
 * SHA256(data) (PROTOCOL.u2f). Bit 0 of the flags is user presence: whether
 * the key was touched.
 */
function securityKey(inner: 'ed25519' | 'ecdsa'): Check {
  return async (key, signature, data, subtle) => {
    if (inner === 'ecdsa' && key.utf8() !== 'nistp256') throw new Malformed('a security key on the wrong curve');
    const point = key.string();
    const application = key.string();
    const raw = signature.string();
    const flags = signature.byte();
    const counter = signature.raw(4);
    const sha256 = async (b: Bytes) => new Uint8Array(await subtle.digest('SHA-256', b));
    const signed = concat(await sha256(application), new Uint8Array([flags]), counter, await sha256(data));
    const ok = inner === 'ed25519'
      ? await subtle.verify({ name: 'Ed25519' }, await subtle.importKey('raw', point, { name: 'Ed25519' }, false, ['verify']), raw, signed)
      : await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
        await subtle.importKey('raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']), ecdsaSignature(raw, 32), signed);
    return { ok, touched: (flags & 1) === 1 };
  };
}

const CHECKS: Readonly<Record<Exclude<KeyType, 'ssh-rsa'>, Check>> = {
  'ssh-ed25519': ed25519,
  'ecdsa-sha2-nistp256': ecdsa('nistp256'),
  'ecdsa-sha2-nistp384': ecdsa('nistp384'),
  'ecdsa-sha2-nistp521': ecdsa('nistp521'),
  'sk-ssh-ed25519@openssh.com': securityKey('ed25519'),
  'sk-ecdsa-sha2-nistp256@openssh.com': securityKey('ecdsa'),
};

function isKeyType(value: string): value is KeyType {
  return value === 'ssh-rsa' || value in CHECKS;
}

async function check(keyType: KeyType, parsed: Parsed, data: Bytes, subtle: SubtleCrypto) {
  const key = new Reader(parsed.publicKey);
  key.string(); // the type, already read
  const signature = new Reader(parsed.signature);
  const sigType = signature.utf8();
  if (keyType === 'ssh-rsa') return rsa(key, sigType, signature, data, subtle);
  if (sigType !== keyType) throw new Malformed(`a ${sigType} signature from a ${keyType} key`);
  return CHECKS[keyType](key, signature, data, subtle);
}

/**
 * Check an armoured SSHSIG over `message` in `namespace`, as
 * `ssh-keygen -Y check-novalidate -n <namespace>` would. Which key signed is
 * in the verdict; whether that is the key the sponsor expected is for the
 * caller, because a valid signature by an unknown key proves nothing.
 */
export async function verifySignature(armoured: string, message: Bytes, namespace: string,
  subtle: SubtleCrypto = crypto.subtle): Promise<Verdict> {
  let parsed: Parsed;
  try {
    parsed = parse(unarmour(armoured));
  } catch (error) {
    return { kind: 'invalid', reason: `the signature file is ${error instanceof Malformed ? error.message : 'unreadable'}`, publicKey: null, fingerprint: null };
  }
  const publicKey = publicKeyLine(parsed.publicKey);
  const signer = { publicKey, fingerprint: await fingerprint(parsed.publicKey, subtle) };
  const keyType = publicKey.split(' ')[0] ?? '';
  if (parsed.namespace !== namespace) {
    return { kind: 'invalid', reason: `it was signed for "${parsed.namespace}", not "${namespace}"`, ...signer };
  }
  if (parsed.hashAlg !== 'sha256' && parsed.hashAlg !== 'sha512') {
    return { kind: 'invalid', reason: `its hash ${parsed.hashAlg} is not one SSHSIG allows`, ...signer };
  }
  if (!isKeyType(keyType)) return { kind: 'unsupported', reason: `this page does not check ${keyType} keys; use ssh-keygen` };
  return checked(keyType, parsed, message, namespace, signer, subtle);
}

async function checked(keyType: KeyType, parsed: Parsed, message: Bytes, namespace: string,
  signer: { publicKey: string; fingerprint: string }, subtle: SubtleCrypto): Promise<Verdict> {
  try {
    const data = await signedData(message, namespace, parsed.hashAlg, subtle);
    const { ok, touched } = await check(keyType, parsed, data, subtle);
    return ok
      ? { kind: 'valid', keyType, namespace, touched, ...signer }
      : { kind: 'invalid', reason: 'the signature does not match these bytes: the file was changed, or signed by someone else', ...signer };
  } catch (error) {
    if (error instanceof Malformed) return { kind: 'invalid', reason: `the signature holds ${error.message}`, ...signer };
    if (error instanceof DOMException && error.name === 'DataError') {
      return { kind: 'invalid', reason: 'the key inside the signature is not a valid key', ...signer };
    }
    // WebCrypto without the algorithm: an older browser, not a bad signature.
    if (error instanceof DOMException && error.name === 'NotSupportedError') {
      return { kind: 'unsupported', reason: `this browser cannot check ${keyType} signatures; ssh-keygen can` };
    }
    throw error;
  }
}
