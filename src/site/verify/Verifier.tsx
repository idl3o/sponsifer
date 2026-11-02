import { useEffect, useState, type DragEvent } from 'react';
import type { Bytes } from '../sshsig';
import { assess, type Outcome } from '../verify';
import { empty, pick, type Picked } from './picked';
import { Results } from './Results';

/**
 * The sponsor door. Files are read by this browser and passed to `assess`;
 * nothing is sent anywhere, and the built page's security policy forbids it.
 * The fingerprint field is the one thing the sponsor brings from outside the
 * report: their agreement.
 */

async function readBytes(file: File): Promise<Bytes> {
  return new Uint8Array(await file.arrayBuffer());
}

function useOutcome(files: Picked<File>, expected: string, subtle: SubtleCrypto): Outcome | null {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => {
    const { document, signature, delivered } = files;
    if (!document || !signature) {
      setOutcome(null);
      return;
    }
    let current = true;
    void (async () => {
      const result = await assess({
        document: await readBytes(document),
        signature: await signature.text(),
        expected,
        delivered: delivered ? await readBytes(delivered) : null,
      }, subtle);
      if (current) setOutcome(result);
    })();
    return () => {
      current = false;
    };
  }, [files, expected, subtle]);
  return outcome;
}

function FileList({ files }: { files: Picked<File> }) {
  const rows: [string, File | null][] = [
    ['Document', files.document], ['Signature', files.signature], ['Delivered file', files.delivered], ['Notice (read it; not checked)', files.notice],
  ];
  const chosen = rows.filter((r): r is [string, File] => r[1] !== null);
  if (chosen.length === 0) return null;
  return <ul className="files">{chosen.map(([what, file]) => <li key={what}>{what}: {file.name}</li>)}</ul>;
}

function Picker({ files, onFiles }: { files: Picked<File>; onFiles: (picked: readonly File[]) => void }) {
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    onFiles(Array.from(event.dataTransfer.files));
  };
  return (
    <div>
      <label className={`drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <input type="file" multiple onChange={(e) => onFiles(Array.from(e.currentTarget.files ?? []))} />
        <strong>Choose the files</strong> you were sent, or drop them here.
        <br /><span className="muted">The report or receipt (<code>.json</code>) and its signature (<code>.sig</code>).</span>
      </label>
      <FileList files={files} />
    </div>
  );
}

export function Verifier({ subtle = crypto.subtle }: { subtle?: SubtleCrypto }) {
  const [files, setFiles] = useState<Picked<File>>(empty);
  const [expected, setExpected] = useState('');
  const outcome = useOutcome(files, expected, subtle);
  return (
    <div>
      <Picker files={files} onFiles={(picked) => setFiles((was) => pick(picked, was))} />
      <div className="field">
        <label htmlFor="expected">The fingerprint in your agreement</label>
        <input id="expected" value={expected} spellCheck={false} autoComplete="off" placeholder="SHA256:…"
          onChange={(e) => setExpected(e.currentTarget.value)} />
        <div className="hint">
          From your contract with the creator, not from the notice that came with the report. A public key line works too.
        </div>
      </div>
      {outcome && <Results outcome={outcome} />}
    </div>
  );
}
