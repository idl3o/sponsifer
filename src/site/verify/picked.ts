/**
 * The files a sponsor drops, sorted by what they are. A report arrives as
 * three files: the `.json` that is signed, its `.sig`, and a `.txt` notice. A
 * receipt arrives the same way, and the delivered file can be added to check
 * it is the one sealed.
 */

export interface Picked<F> {
  document: F | null;
  signature: F | null;
  /** Anything else: for a receipt, the delivered file. */
  delivered: F | null;
  /** The notice, which is for reading and is not checked: it came by the same route as the report. */
  notice: F | null;
}

const isJson = (name: string) => name.toLowerCase().endsWith('.json');

/** Sort dropped files by name. A later file of the same kind replaces an earlier one. */
export function pick<F extends { name: string }>(files: readonly F[], into: Picked<F> = empty()): Picked<F> {
  return files.reduce<Picked<F>>((acc, file) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.sig')) return { ...acc, signature: file };
    if (isJson(name)) return { ...acc, document: file };
    if (name.endsWith('.txt')) return { ...acc, notice: file };
    return { ...acc, delivered: file };
  }, into);
}

export function empty<F>(): Picked<F> {
  return { document: null, signature: null, delivered: null, notice: null };
}
