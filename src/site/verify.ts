import { NAMESPACE, readDocument, type Document } from './documents';
import { fingerprint, keyBlob, verifySignature, type Bytes, type Verdict } from './sshsig';

/**
 * Everything the sponsor door checks, as a list a person can read.
 *
 * A valid signature is not enough. Anyone can sign a report with their own
 * key, so what makes a report the creator's is that the key which signed it is
 * the one in the agreement. Until the sponsor enters that fingerprint, the
 * outcome is not trusted, however good the signature.
 */

export type State = 'pass' | 'fail' | 'warn';

export interface Check {
  label: string;
  state: State;
  why: string;
}

export interface Outcome {
  document: Document;
  verdict: Verdict | null;
  checks: Check[];
  /** Every check passed, including the key against the agreement. */
  trusted: boolean;
}

export interface Inputs {
  /** The `.report.json` or `.receipt.json`, as bytes: the signature covers them exactly. */
  document: Bytes;
  /** The `.sig` file's text. */
  signature: string;
  /** What the sponsor typed from their agreement: a fingerprint, a public key, or an allowed_signers line. */
  expected: string;
  /** For a receipt, the file that was delivered, to check it is the one sealed. */
  delivered: Bytes | null;
}

const KEY_TYPES = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;

export type Expected = { kind: 'none' } | { kind: 'fingerprint'; value: string } | { kind: 'unreadable' };

/** The fingerprint the sponsor expects, from whatever form they pasted. */
export async function expectedKey(input: string, subtle: SubtleCrypto = crypto.subtle): Promise<Expected> {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'none' };
  const print = /SHA256:[A-Za-z0-9+/]{43}/.exec(trimmed);
  if (print) return { kind: 'fingerprint', value: print[0] };
  const tokens = trimmed.split(/\s+/);
  const at = tokens.findIndex((t) => KEY_TYPES.test(t));
  try {
    if (at >= 0) return { kind: 'fingerprint', value: await fingerprint(keyBlob(`${tokens[at]} ${tokens[at + 1] ?? ''}`), subtle) };
  } catch {
    return { kind: 'unreadable' };
  }
  return { kind: 'unreadable' };
}

function signatureCheck(verdict: Verdict): Check {
  const label = 'The signature';
  if (verdict.kind === 'valid') return { label, state: 'pass', why: `Good, by the ${verdict.keyType} key ${verdict.fingerprint}.` };
  if (verdict.kind === 'unsupported') return { label, state: 'warn', why: `Not checked: ${verdict.reason}.` };
  return { label, state: 'fail', why: `Not good: ${verdict.reason}.` };
}

function agreementCheck(expected: Expected, verdict: Verdict): Check {
  const label = 'The key, against your agreement';
  const signer = verdict.kind === 'unsupported' ? null : verdict.fingerprint;
  if (expected.kind === 'none') {
    return { label, state: 'warn', why: `Enter the fingerprint from your agreement. A good signature by a key you never agreed proves nothing${
      signer ? `; this one was made by ${signer}` : ''}.` };
  }
  if (expected.kind === 'unreadable') return { label, state: 'warn', why: 'That is not a fingerprint (SHA256:…) or an SSH public key.' };
  return expected.value === signer
    ? { label, state: 'pass', why: 'It is the key in your agreement.' }
    : { label, state: 'fail', why: `It is not the key in your agreement: you expect ${expected.value}${signer ? `, and it was signed by ${signer}` : ''}.` };
}

function namesItsSigner(document: Exclude<Document, { kind: 'unknown' }>, verdict: Verdict): Check | null {
  if (verdict.kind === 'unsupported' || verdict.publicKey === null) return null;
  const named = document.publicKey.trim().split(/\s+/).slice(0, 2).join(' ');
  return named === verdict.publicKey
    ? { label: 'The key it names', state: 'pass', why: 'The document names the key that signed it.' }
    : { label: 'The key it names', state: 'fail', why: 'The document names a different key from the one that signed it.' };
}

async function deliveredCheck(document: Document, delivered: Bytes | null, subtle: SubtleCrypto): Promise<Check | null> {
  if (document.kind !== 'receipt' || delivered === null) return null;
  const digest = Array.from(new Uint8Array(await subtle.digest('SHA-256', delivered)), (b) => b.toString(16).padStart(2, '0')).join('');
  return digest === document.sealedSha256.toLowerCase()
    ? { label: 'The delivered file', state: 'pass', why: 'It is byte for byte the file this receipt seals.' }
    : { label: 'The delivered file', state: 'fail', why: 'It is not the file this receipt seals: it was changed, re-encoded, or is another file.' };
}

/** Check a document and its signature against what the sponsor expects. */
export async function assess(inputs: Inputs, subtle: SubtleCrypto = crypto.subtle): Promise<Outcome> {
  const document = readDocument(inputs.document);
  if (document.kind === 'unknown') {
    const why = `This is not a Sponsifer report or licence receipt: ${document.reason}.`;
    return { document, verdict: null, trusted: false, checks: [{ label: 'The document', state: 'fail', why }] };
  }
  const verdict = await verifySignature(inputs.signature, inputs.document, NAMESPACE[document.kind], subtle);
  if (verdict.kind !== 'valid') {
    // The key inside a signature that does not hold is only a claim, so nothing else is checked against it.
    return { document, verdict, trusted: false, checks: [signatureCheck(verdict)] };
  }
  const checks = [
    signatureCheck(verdict),
    agreementCheck(await expectedKey(inputs.expected, subtle), verdict),
    namesItsSigner(document, verdict),
    await deliveredCheck(document, inputs.delivered, subtle),
  ].filter((c): c is Check => c !== null);
  if (verdict.touched === false) {
    checks.push({ label: 'The security key', state: 'warn',
      why: 'It signed without being touched. ssh-keygen accepts this too, but a touch shows a person was present.' });
  }
  return { document, verdict, checks, trusted: checks.every((c) => c.state === 'pass') };
}
