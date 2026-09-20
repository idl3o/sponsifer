/**
 * What putting a deal into OBS did, as `obs_setup.Result.to_json()` in Python
 * reports it, and the sentence that tells the creator. The work is the
 * server's; this only parses the answer and says it plainly, because a tool
 * that changes someone's scenes owes them an exact account.
 */

export type SetupAction = 'create' | 'repoint' | 'keep' | 'blocked';

export interface SetupStep {
  /** The OBS source, by its conventional name. */
  source: string;
  action: SetupAction;
  /** The deal it was showing before, when it was pointed elsewhere. */
  was: string | null;
}

export interface ObsSetupResult {
  deal: string;
  /** The scene new sources were added to: the one on screen at the time. */
  scene: string;
  steps: SetupStep[];
}

const ACTIONS: readonly SetupAction[] = ['create', 'repoint', 'keep', 'blocked'];

function parseStep(value: unknown): SetupStep | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>; // narrowed field by field below
  const action = ACTIONS.find((a) => a === o.action);
  if (typeof o.source !== 'string' || !action) return null;
  if (o.was !== null && typeof o.was !== 'string') return null;
  return { source: o.source, action, was: o.was };
}

/** The result as typed data, or null when the answer is not one. */
export function parseObsSetup(data: unknown): ObsSetupResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>; // narrowed field by field below
  if (typeof o.deal !== 'string' || typeof o.scene !== 'string' || !Array.isArray(o.steps)) return null;
  const steps = (o.steps as unknown[]).map(parseStep);
  return steps.every((s): s is SetupStep => s !== null) ? { deal: o.deal, scene: o.scene, steps } : null;
}

const list = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;

/** Exactly what was done to the creator's OBS, and what was left alone. */
export function setupSentence(result: ObsSetupResult): string {
  const named = (action: SetupAction) => result.steps.filter((s) => s.action === action);
  const parts: string[] = [];
  const made = named('create').map((s) => s.source);
  if (made.length > 0) {
    parts.push(`made ${list(made)} in the scene "${result.scene}", hidden until you show ${made.length === 1 ? 'it' : 'them'}`);
  }
  for (const step of named('repoint')) {
    parts.push(`pointed ${step.source} at this deal${step.was ? ` (it was showing ${step.was})` : ''}`);
  }
  const kept = named('keep').map((s) => s.source);
  if (kept.length > 0) parts.push(`${list(kept)} ${kept.length === 1 ? 'was' : 'were'} already right`);
  const blocked = named('blocked').map((s) => s.source);
  if (blocked.length > 0) {
    parts.push(`left ${list(blocked)} alone, because OBS has something else by that name that is not a browser source`);
  }
  const text = parts.join('; ');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : 'Nothing needed doing.';
}
