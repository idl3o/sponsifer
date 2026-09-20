# The name

The project has been renamed twice, identifiers included each time: from **Sponsorable** to **Sponsifable** on 18 September 2026, and from Sponsifable to **Sponsifer** on 20 September 2026. This note records what moved, what deliberately did not, what each candidate was checked against, and what earlier candidates were rejected for, so the next naming attempt starts from the prior-art check rather than repeating it.

## Why each was done all at once

Every migration below was a no-op on both days. Nothing had been published to PyPI, TestPyPI or npm, no release had been tagged, no C2PA manifest had been embedded outside tests, and no home directory existed on the author's machine under either name. A rename later would have cost a compatibility path for each identifier; a rename then cost a search and replace. The window closes with the first release: from then on, each line below becomes a migration with users on the other side of it.

The second rename was not quite free. The repository had been public under the second name for two days, so one compatibility path was owed and is kept: a browser save written under either earlier key (below).

## What moved

**Prose** goes through one constant on each side, so the next rename touches one line:

- `src/brand.ts`: `PRODUCT`, `TAGLINE`.
- `python/sponsifer/brand.py`: `PRODUCT`.

**Identifiers**, all changed together, both times:

| Identifier | First | Second | Now | Where |
|---|---|---|---|---|
| PyPI distribution and the command | `sponsorable` | `sponsifable` | `sponsifer` | `pyproject.toml` |
| Python package directory | `python/sponsorable/` | `python/sponsifable/` | `python/sponsifer/` | the whole tree |
| SSHSIG namespaces | `sponsorable-receipt` | `sponsifable-receipt`, `sponsifable-delivery` | `sponsifer-receipt`, `sponsifer-delivery` | `sshsig.py`, `report.py` |
| C2PA assertion label | `org.sponsorable.licence` | `org.sponsifable.licence` | `org.sponsifer.licence` | `manifest.py` |
| C2PA claim generator | `sponsorable` | `sponsifable` | `sponsifer` | `manifest.py` |
| Home directory and its override | `~/.sponsorable`, `SPONSORABLE_HOME` | `~/.sponsifable`, `SPONSIFABLE_HOME` | `~/.sponsifer`, `SPONSIFER_HOME` | `ledger.py` |
| Browser save key | `sponsorable-v1` | `sponsifable-v1` | `sponsifer-v1` | `useStore.ts` |
| Sync revision key | `sponsorable-sync-revision` | `sponsifable-sync-revision` | `sponsifer-sync-revision` | `sync.ts` |
| Export file name | `sponsorable.json` | `sponsifable.json` | `sponsifer.json` | `App.tsx` |
| npm package name | `sponsorable` | `sponsifable` | `sponsifer` | `package.json` |

## What deliberately did not move

- **The timestamp fixture's digest.** `python/tests/test_timestamp.py` hashes the literal bytes `sponsorable api probe`, because those are the bytes DigiCert signed in September 2026. A rename cannot change what a timestamp covers, and a test that pretended otherwise would be testing nothing.
- **A save written under an earlier browser key.** `adoptRenamedSave()` in `useStore.ts` copies a save from `sponsifable-v1`, or failing that `sponsorable-v1`, to the new key once, and leaves the original where it is. Where both hold a save, the later name's is the later work. A creator who had only ever run `npm run dev` kept their work in the browser and nowhere else; renaming the key without this would have stranded it. Remove it once no such browser can plausibly remain.
- **The sync revision key is not carried**, in either rename. A browser whose last-seen revision sits under an old key adopts the file on its next start rather than writing its own copy up. That costs an edit only if it was made while the server was down and never reached the file, and with no release there is no such browser to lose one.

The GitHub repository was renamed to `idl3o/sponsifer` on 20 September 2026, and `idl3o/sponsorable` and `idl3o/sponsifable` both redirect to it for as long as neither name is reused. The URLs were moved only after the repository was, because GitHub redirects an old name forward and never a new name back: a URL under the old name works before and after a rename, and one under the new name works only after. Every URL in the docs, `package.json`, `pyproject.toml` and `src/domain/deals.ts` now points at the new one, including the colophon of `docs/archive/2026-09-the-defensible-number.md`, which is still a working draft. Once that paper is marked published, a change like this becomes an erratum.

## Still to do

- **PyPI itself is deliberately unclaimed.** Neither index reserves a name; the first upload takes it. TestPyPI was claimed on 20 September 2026 with `0.2.0.dev0`, built from commit 1fe1a71 by release run 35531438611 and carrying PyPI's provenance attestation. It was a development version on purpose: a version can never be uploaded twice and the workflow skips one that is already there, so claiming with `0.2.0` would have left that day's build under the number for good, and the rehearsal before the real 0.2.0 would have installed a stale file without saying so. The commit lived on a throwaway branch, since deleted; `main` never carried the development version. Nothing goes to PyPI until the first release, which takes the name there: a `v*` tag and an approval of the `pypi` environment (see `docs/RELEASING.md`). Until then the name on PyPI is open to anyone.
- **Search the remaining trademark registers**, which no script reached: EUIPO and the USPTO for SPONSIFER, and all three registers for the neighbours SPONSIFIER, SPONSAFIER and SPONSIFI.

## Names checked and rejected

**Sponsify**, checked 18 September 2026. Rejected: comprehensively taken in this exact market.

- An npm package exists under the name, and the GitHub account `sponsify` is taken.
- At least six live businesses trade as Sponsify in sponsorship or creator marketing: sponsify.io (sponsorship ROI), sponsify.ge (creator collaboration), sponsify.co (YouTube native advertising), sponsifyagency.com, sponsifyapp.com, and SponsifyMe, with LinkedIn and Crunchbase entries besides.

**Sponsoar**, checked 12 September 2026. Rejected: an active UK company in sponsorship services.

- [SPONSOAR LTD](https://find-and-update.company-information.service.gov.uk/company/14908657), Companies House 14908657, incorporated 1 June 2023, registered in Bristol, trading at sponsoar.co.uk as a sports sponsorship marketplace. An active UK trader under the same name in the same services is a passing-off exposure whether or not the mark is registered.
- A second sponsorship-management platform traded at sponsoar.app; the domain no longer resolves.
- Princeton's DataSpace holds a thesis titled *SponSoar: The Data-Driven Influencer Marketing Tool*.
- The GitHub organisation `Sponsoar` has existed since 2022.
- The name was free on PyPI, TestPyPI and npm, which was not enough.

## What Sponsifer was checked against

On 20 September 2026. Clean on every register that answers a script; two near neighbours hold rights; no script reached the trademark registers. The author chose the name knowing all three, and the same day checked the UK trademark register by hand and found the name available. That is the check that matters legally at home; it says nothing about EUIPO or the USPTO, and availability does not settle a likelihood-of-confusion objection from either neighbour below. The word reads as *spons-*, the pledge, and *-fer*, bearing.

- Free on PyPI, TestPyPI, npm and crates.io. No GitHub account, and GitHub's repository and user search return nothing. Companies House returns no results. A web search finds no company or product.
- sponsifer.com, .net, .org, .io, .app, .dev, .ai, .co and .co.uk were unregistered by RDAP, which is a stronger check than a name failing to resolve.

**The known risks.**

- **Toyota Sponsafier.** A Toyota Racing campaign, 2010–11 and revived in 2022, in which fans design a sponsor's livery for a race car. Toyota registered sponsafier.com and the misspelling sponsifier.com on the same day, 29 January 2010, and has paid for both to January 2028. Sponsifer is one letter from the misspelling Toyota chose to defend. Whether SPONSAFIER is a live registered mark was not established.
- **SPONSIFI.** Canadian registration TMA1175013, ConnectionPoint Systems Inc., North Vancouver, registered 5 April 2023 to 2033, in classes 35, 36 and 42: the first and last are the classes this tool would sit in. Found in Canada only. sponsifi.com now redirects to connectionpoint.com, so the product looks dormant; the registration is not.
- **The Sponsify family.** Said aloud, Sponsifer is heard as *sponsifier*, the agent noun of Sponsify, which is the name six live businesses already trade under (above).
- [Sponsara.ai](https://sponsara.ai/), the known risk of the second name, is further from this one but in the same services class.

## What Sponsifable was checked against

On 18 September 2026: free on PyPI, TestPyPI and npm; the GitHub account was free; Companies House returned no results; a web search found no company, product or trademark, only the archaic dictionary word *sponsible*; and sponsifable.com, .io, .co.uk and .app did not resolve.

On the same day the author checked the UK trademark register and found the name available. That check was for Sponsifable and does not carry over to Sponsifer.

**The known risk.** [Sponsara.ai](https://sponsara.ai/) sells "AI sponsorship intelligence" for YouTube influencers — the same services class, one letter and a stress pattern away. Availability on the register does not settle a likelihood-of-confusion objection from an existing trader; if an application is ever made, that pair is what an examiner or an opponent would look at.

## How to check the next one

Companies House, the UK IPO register, PyPI, TestPyPI, npm, GitHub accounts and organisations, the obvious domains by RDAP rather than by DNS, and a plain web search for the same market and for the name's misspellings. Record the result here whether it passes or fails.
