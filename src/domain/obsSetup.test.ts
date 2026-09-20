import { describe, expect, it } from 'vitest';
import { parseObsSetup, setupSentence, type ObsSetupResult } from './obsSetup';

const result = (steps: ObsSetupResult['steps']): ObsSetupResult => ({ deal: 'dl-104', scene: 'Gameplay', steps });

describe('parseObsSetup', () => {
  it('accepts what the server sends', () => {
    const sent = { deal: 'dl-104', scene: 'Gameplay', steps: [{ source: 'Sponsor overlay', action: 'repoint', was: 'dl-101' }] };
    expect(parseObsSetup(sent)).toEqual(sent);
  });

  it('refuses anything else, including an action it does not know', () => {
    const step = { source: 'Sponsor overlay', action: 'create', was: null };
    for (const bad of [null, [], {}, { deal: 'dl-104', scene: 'x', steps: 'none' }, { deal: 'dl-104', scene: 'x', steps: [{ ...step, action: 'delete' }] }, { deal: 'dl-104', scene: 'x', steps: [{ ...step, was: 7 }] }]) {
      expect(parseObsSetup(bad)).toBeNull();
    }
  });
});

describe('setupSentence', () => {
  it('says what was made, where, and that it is hidden', () => {
    expect(setupSentence(result([
      { source: 'Sponsor slate', action: 'create', was: null },
      { source: 'Sponsor card', action: 'create', was: null },
    ]))).toBe('Made Sponsor slate and Sponsor card in the scene "Gameplay", hidden until you show them.');
  });

  it('says whose ad a source was showing before it was pointed at this deal', () => {
    expect(setupSentence(result([{ source: 'Sponsor overlay', action: 'repoint', was: 'dl-101' }])))
      .toBe('Pointed Sponsor overlay at this deal (it was showing dl-101).');
  });

  it('accounts for everything, including what it would not touch', () => {
    expect(setupSentence(result([
      { source: 'Sponsor overlay', action: 'blocked', was: null },
      { source: 'Sponsor lower third', action: 'keep', was: null },
      { source: 'Sponsor slate', action: 'create', was: null },
      { source: 'Sponsor card', action: 'repoint', was: null },
    ]))).toBe(
      'Made Sponsor slate in the scene "Gameplay", hidden until you show it; pointed Sponsor card at this deal; '
      + 'Sponsor lower third was already right; left Sponsor overlay alone, because OBS has something else by that name that is not a browser source.',
    );
  });

  it('says so when there was nothing to do', () => {
    expect(setupSentence(result([]))).toBe('Nothing needed doing.');
  });
});
