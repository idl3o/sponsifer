# Provenance for delivered media

A creator who sells usage rights is selling something they cannot currently enforce. "Paid whitelisting, 30 days" is a promise, and a sponsor who keeps the ad running on day 90 has, in practice, bought the ninety-day licence at the thirty-day price. This document describes how Sponsifer lets a creator establish, at the moment of delivery, which file was licensed on which terms, and later demonstrate that a running ad is that file.

It is designed for a creator who self-hosts on a small budget: every component is free, runs locally, and needs no account.

## Two requirements

**Sealing is opt-in.** Nothing is watermarked by default. A creator who wishes to establish rights on a deal runs `sponsifer seal` against that deal, reads a confirmation listing exactly what will be bound, and agrees. The web app never seals anything.

**Sealing cannot be applied retroactively.** A creator must not be able to watermark a file after the fact and claim it was licensed on terms that suit them.

The second requirement has a consequence that shapes everything below. The tool is local-first, so the creator controls the code and can edit any file it writes. A rule such as "the app refuses to seal a delivered deal" guards against mistakes. It guarantees nothing. Non-retroactivity therefore has to be a property of the evidence rather than of the software.

## Three bindings

A claim that a running ad breaches a licence holds only when all three of the following hold. None of them depends on trusting the creator's software.

1. **Content.** The watermark must be decoded from the ad itself, as downloaded from a public ad library. A creator cannot insert a watermark into an advertisement a sponsor is already running. Sealing a file after delivery marks only the creator's own copy, and the ad will not decode.
2. **Time.** Each sealed deal carries an RFC 3161 timestamp over a commitment to its receipt. The timestamp must precede the ad's "started running" date, which public ad libraries display. A backdated ledger entry receives today's timestamp and fails.
3. **Terms.** The licence receipt is sent to the sponsor with the delivery, so the sponsor holds the original terms from the first day and the creator cannot later produce different ones.

The third binding exists because the watermark is too small to carry the terms. TrustMark encodes 100 raw bits, fewer once error correction is applied. A commitment truncated to that length is open to a birthday search: a creator could generate two receipts with different terms and the same truncated identifier, timestamp both, and reveal whichever suited them later. At the most robust error-correction setting that search takes seconds. The watermark therefore carries a **serial number only**, a pointer, and the terms live in a signed receipt that the counterparty already holds. No public ledger is required, because the party with an interest in catching equivocation already has a copy.

## What a seal contains

The receipt is canonical JSON with sorted keys:

| Field | Meaning |
|---|---|
| `version` | Receipt format, currently 1. |
| `serial` | The watermark payload, hex. Unique per creator. |
| `salt` | 16 random bytes, hex. Stops anyone brute-forcing the terms from the public timestamped digest. |
| `dealId` | The deal in the creator's workspace. |
| `creator`, `sponsor` | Names as recorded on the deal. |
| `platform`, `format` | What was sold. |
| `usageRights`, `paidUsageDays` | What the sponsor may do, and for how many days of paid running, counted from the first paid run. `0` means no paid running; `null` means unlimited. |
| `exclusivityDays` | Category exclusivity granted. |
| `grantedOn`, `sealedOn` | ISO dates. |
| `masterSha256` | The file before marking. |
| `sealedSha256` | The exact file delivered. |
| `perceptualHash` | A pHash of the delivered file, for matching re-encoded copies when a watermark has not survived. |
| `publicKey` | The creator's OpenSSH public key. Its SHA256 fingerprint belongs in the contract or invoice, which is what makes a key nobody else vouches for sufficient: the sponsor already knows who they contracted with. |

The **commitment** is the SHA-256 of that canonical JSON, and a timestamp authority timestamps it. The creator signs the same bytes with their own SSH key, using OpenSSH's signature format (SSHSIG, namespace `sponsifer-receipt`). The receipt, the signature and the timestamp token together form the seal.

## Signing with the creator's SSH key

Sponsifer holds no signing key of its own. `ssh-keygen -Y sign` does the signing, so a passphrase, ssh-agent or a hardware key (`ed25519-sk`) protects the key exactly as it protects the creator's server logins, and Sponsifer never reads the private half. Three things follow:

- **The sponsor can check a receipt with nothing from this project.** The notice carries an `allowed_signers` line and the `ssh-keygen -Y verify` command. OpenSSH ships with Windows, macOS and Linux. A receipt the other party can verify only with the creator's own software would be worth less.
- **Identity can be checked against something public.** A technical creator has usually published their key at `github.com/<user>.keys`. The contract's fingerprint remains the binding link; the public key is corroboration.
- **The namespace stops replay.** A signature made for a receipt cannot be presented as a signature over anything else, and the reverse.

Ed25519 SSH signatures are produced and checked in `python/sponsifer/sshsig.py` directly, byte-compatible with OpenSSH in both directions; the tests prove it against the installed `ssh-keygen`. Other key types are signed and checked by `ssh-keygen`. A C2PA manifest carrying the same terms as IPTC rights metadata is embedded in the delivered file, for anyone whose pipeline preserves it. Most platforms strip it, which is why the watermark exists.

## The one network call

Sealing sends one SHA-256 digest to an RFC 3161 timestamp authority, DigiCert's free one by default. The digest reveals nothing about the deal, because the receipt is salted. The call happens only when the creator has chosen to seal, and the confirmation says so before it happens. A creator who never seals never makes it.

That is the only call carrying anything derived from the creator's data. The one other network access is a one-off download of TrustMark's model weights from Adobe's host, the first time the watermark is used. It sends nothing about the creator, and `sponsifer setup` does it deliberately, ahead of time, rather than in the middle of a seal.

## Disclosed, not covert

The receipt tells the sponsor that the file carries a watermark and what terms it records. Deterrence works only when the sponsor knows; a hidden mark discovered later damages the relationship it was meant to protect; and a delivered file that differs from its specification should be disclosed regardless.

## Where the asset goes

- **Delivered files.** Buyouts, paid-social creative and UGC are handed over as files, and the sponsor re-encodes them into ads on Meta, TikTok or YouTube. This is the case the watermark exists for.
- **Platform whitelisting.** Meta partnership ads and TikTok Spark Ads boost the creator's own post through an in-app permission, usually with a duration the creator sets. No file changes hands, so the platform permission is the enforcement, and revoking it is the remedy. The watermark matters only if the sponsor rips the post, which argues for sealing the organic upload under the same serial.

## Checking a sighting

`sponsifer verify` takes an ad file downloaded from a public ad library and the date the library says it started running. It decodes the serial, finds the receipt, checks the signature, the timestamp and the ordering, and reports the facts: which deal, which terms, how many days of paid running were permitted, and how many the sighting shows.

It does not price the overrun. Every market assumption lives in `src/domain/benchmarks.ts`, so the extension invoice is composed in the web app from the verified facts. Paid usage is sold by the 30-day period, so the overrun is the further periods the sponsor took, each at the per-period rate the licence was priced on, scaled by the discount already negotiated and never below the per-period minimum.

## The delivery report

A stream sponsor's question is not "which file?" but "was it up, and when?". The on-air log answers it, but the log is the creator's own file on the creator's own machine. `sponsifer report` folds the log into intervals, binds the log file's SHA-256 into the document, and signs it with the same SSH key that signs receipts — under a different SSHSIG namespace, `sponsifer-delivery`, so a signature over a report can never be presented as a signature over a licence, or the reverse.

The report is an index into the recording, not proof on its own, and its notice says so. Each interval is a UTC span and, where the logger saw the stream start, an offset into the stream, so the sponsor opens the VOD at that minute and sees the placement. The notice names how long the platform keeps the recording, so the sponsor checks in time. It hides nothing the log could not settle: every direct check of OBS that contradicted an event is counted, and an interval the logger stopped inside is named with its time. It carries no price. The sponsor verifies it with `ssh-keygen -Y verify`, exactly as they verify a receipt.

## Survival

The design is theory until the watermark survives the real path. `scripts/survival.py` runs the local proxy. On 24 frames drawn evenly from 23,000 SDXL outputs, on 10 September 2026, bit-exact recovery of the serial was:

| Transform | Q, 40-bit | P, 40-bit | P, 61-bit |
|---|---|---|---|
| None, JPEG q85 and q70 | 100% | 96% | 100% |
| JPEG q50 | 100% | 96% | 71% |
| WebP q75 | 100% | 96% | 96% |
| 1080w, 720w and 480w, then JPEG | 100% | 100%, 83%, 25% | 100%, 75%, 8% |
| Centre crop to 90% and 80% | 100% | 96–100% | 100% |
| Reframe landscape to 4:5 | **0%** | 96% | 100% |
| Reframe landscape to 9:16 | **0%** | **0%** | **0%** |
| Call-to-action banner over the bottom 15% | 100% | 96% | 96% |
| Colour grade | 100% | 96% | 96% |
| H.264 1080p crf 23, 720p crf 28 | 100% | 96%, 88% | 96% |

Sponsifer uses **model Q with the 40-bit BCH_SUPER schema.** It survived everything except reframing. So the rule is: **seal each aspect ratio you deliver.** A sponsor who reframes your landscape file into a portrait ad themselves will defeat the mark, and the pHash comparison is all that remains.

**Decoding is strict.** TrustMark detects the error-correction schema from the payload itself, and 8 of 400 unmarked images decoded as "present" under one of the weaker schemas. Accepting only BCH_SUPER at exactly 40 bits took that to none of 400. `verify` also requires the serial to be in the creator's own ledger, so a false positive would additionally have to hit one of their issued serials.

A proxy is not a platform. The go or no-go test is manual and belongs to the creator: mark a file, push it through each real route, download what comes out, and decode it. The protocol is in `scripts/SURVIVAL.md`.

## What testing changed

- **C2PA signs with ES256, not Ed25519.** An Ed25519 chain signed, but the claim signature then failed validation. C2PA gets its own P-256 key under a local root, because C2PA refuses a bare self-signed certificate and an SSH key cannot provide an X.509 chain. That key carries no identity and can be regenerated; receipts are signed with the creator's SSH key.
- **A failed signature removes the marked file,** exactly as a failed timestamp does. A cancelled passphrase prompt must not leave a deliverable behind.
- **The creator must say how the asset was made.** A C2PA claim of creation needs a digital source type, and the tool cannot know whether a file came from a camera, from software or from a model. `seal --source capture|creation|ai|ai-composite` is required rather than defaulted, because a default would be a claim nobody made. This also makes the manifest an honest AI disclosure where one is needed.
- **The licence window is frozen on the deal.** `paidUsageDays` is recorded when the deal closes, not looked up later, because the licence is what was agreed rather than what the benchmarks say a tier means today. It also keeps every market assumption out of the Python side.
- **A failed timestamp removes the marked file.** Otherwise a file carrying a serial that is in no ledger could be delivered as if it were sealed.
- **Video is refused.** Only still images can be sealed until a video watermark passes the same survival test.

## What is declined

- **Sealing an existing file or an already-delivered deal.** There is no path for it, and none should be added.
- **Putting the terms in the watermark.** The payload is too short to commit to them safely.
- **Treating a missing watermark as evidence.** TrustMark ships a removal model. The mark stops careless reuse, not a sponsor determined to strip it, and absence proves nothing.
- **Automated monitoring of ad libraries.** The APIs require identity verification and cover limited ground. Detection is a person downloading an ad and running `verify`.
- **Attesting the media kit's statistics.** A creator signing their own view counts proves nothing. Only attestation from the platform would, and that needs the OAuth and platform APIs the project declines.
- **Proving identity to strangers.** The C2PA chain shows as an unrecognised signer to any validator, and the SSH key is vouched for by nobody but the creator and, where published, their GitHub account. The trust that matters here is bilateral and is established by the contract.
- **Holding the creator's key.** Sponsifer never reads or stores a private signing key. OpenSSH does that job.
