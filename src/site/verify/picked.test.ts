import { describe, expect, it } from 'vitest';
import { empty, pick } from './picked';

const f = (name: string) => ({ name });

describe('pick', () => {
  it('sorts the three files a report arrives as, and a delivered file', () => {
    const picked = pick([f('dl-104-20261102T2200Z.txt'), f('dl-104-20261102T2200Z.report.json.sig'), f('dl-104-20261102T2200Z.report.json'), f('reel.sealed.png')]);
    expect(picked).toEqual({
      document: f('dl-104-20261102T2200Z.report.json'),
      signature: f('dl-104-20261102T2200Z.report.json.sig'),
      notice: f('dl-104-20261102T2200Z.txt'),
      delivered: f('reel.sealed.png'),
    });
  });

  it('keeps what was chosen before, and a later file of a kind replaces the earlier', () => {
    const first = pick([f('a.report.json')]);
    const second = pick([f('a.report.json.sig'), f('b.receipt.json')], first);
    expect(second).toEqual({ ...empty(), document: f('b.receipt.json'), signature: f('a.report.json.sig') });
  });

  it('reads extensions in any case', () => {
    expect(pick([f('X.REPORT.JSON'), f('X.REPORT.JSON.SIG')])).toMatchObject({ document: f('X.REPORT.JSON'), signature: f('X.REPORT.JSON.SIG') });
  });
});
