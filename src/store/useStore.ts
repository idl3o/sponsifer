import { create, type StoreApi } from 'zustand';
import { persist } from 'zustand/middleware';
import { produce } from 'immer';
import { FORMATS_BY_PLATFORM } from '../domain/benchmarks';
import { DEFAULT_BOARD } from '../domain/board';
import { DEFAULT_EMBLEM } from '../domain/emblem';
import { DEFAULT_TERMS } from '../domain/pricing';
import type {
  BoardSpec,
  Channel,
  CreatorProfile,
  Deal,
  DealTerms,
  EmblemStyle,
  Platform,
  Prospect,
  ProofPoint,
  Sighting,
  SponsorArt,
} from '../domain/types';
import { WORKSPACE_VERSION, parseWorkspace, seqFloor, type Workspace } from '../domain/workspace';
import { SAMPLE_PROFILE, SAMPLE_PROSPECTS } from './sample';

export type Tab = 'profile' | 'rate-card' | 'offer' | 'media-kit' | 'prospects' | 'outreach' | 'deals' | 'ads' | 'board';

interface State {
  profile: CreatorProfile;
  terms: DealTerms;
  prospects: Prospect[];
  deals: Deal[];
  board: BoardSpec;
  /** The creator's house style for the stream emblem. */
  emblem: EmblemStyle;
  tab: Tab;
  /** Prospect currently open in the outreach composer. */
  activeProspectId: string | null;
  /** Monotonic counter behind every generated id, so ids stay deterministic. */
  seq: number;
}

interface Actions {
  setTab: (tab: Tab) => void;
  updateProfile: (patch: Partial<CreatorProfile>) => void;
  updateGeo: (tier: 'tier1' | 'tier2' | 'tier3', value: number) => void;
  addChannel: (platform: Platform) => void;
  updateChannel: (id: string, patch: Partial<Channel>) => void;
  removeChannel: (id: string) => void;
  addProofPoint: () => void;
  updateProofPoint: (id: string, patch: Partial<ProofPoint>) => void;
  removeProofPoint: (id: string) => void;
  setTerms: (patch: Partial<DealTerms>) => void;
  addProspect: () => void;
  updateProspect: (id: string, patch: Partial<Prospect>) => void;
  removeProspect: (id: string) => void;
  openOutreach: (id: string) => void;
  /**
   * File a closed deal and move its prospect to the matching stage.
   * @param build receives a fresh id and returns the record, or null to abort.
   */
  recordDeal: (build: (id: string) => Deal | null) => void;
  updateDeal: (id: string, patch: Partial<Omit<Deal, 'id'>>) => void;
  removeDeal: (id: string) => void;
  addSighting: (dealId: string, sighting: Omit<Sighting, 'id'>) => void;
  removeSighting: (dealId: string, sightingId: string) => void;
  setBoard: (patch: Partial<BoardSpec>) => void;
  setEmblem: (patch: Partial<EmblemStyle>) => void;
  /** The sponsor's part of a deal's emblem, or null to remove it. */
  setSponsorArt: (dealId: string, art: SponsorArt | null) => void;
  /** Replace all stored data with a workspace that has already been validated. */
  importAll: (workspace: Workspace) => void;
  resetToSample: () => void;
}

const initialState: State = {
  profile: SAMPLE_PROFILE,
  terms: DEFAULT_TERMS,
  prospects: SAMPLE_PROSPECTS,
  deals: [],
  board: DEFAULT_BOARD,
  emblem: DEFAULT_EMBLEM,
  tab: 'rate-card',
  activeProspectId: null,
  seq: 100,
};

type Persisted = Pick<State, 'profile' | 'terms' | 'prospects' | 'deals' | 'board' | 'emblem' | 'seq'>;

/**
 * Upgrade a save written by an older version. A save that fails validation is
 * copied aside rather than discarded, so a bug here can never cost a creator
 * their prospect list, and the app starts from the sample.
 */
function migrate(persisted: unknown, version: number): Persisted {
  const parsed = parseWorkspace({ ...(persisted as object), version: Math.max(1, version) });
  const seq = (persisted as { seq?: unknown } | null)?.seq;
  if (parsed.ok) {
    const { profile, terms, prospects, deals, board, emblem } = parsed.workspace;
    return { profile, terms, prospects, deals, board, emblem, seq: typeof seq === 'number' ? seq : 100 };
  }
  try {
    localStorage.setItem(`sponsifer-unreadable-v${version}`, JSON.stringify(persisted));
  } catch {
    // Storage full or blocked. Nothing more can be done from here.
  }
  const { profile, terms, prospects, deals, board, emblem } = initialState;
  return { profile, terms, prospects, deals, board, emblem, seq: initialState.seq };
}

/** Where this browser keeps its copy. */
export const SAVE_KEY = 'sponsifer-v1';
/** What that key was called before each rename of September 2026, newest first. */
const RENAMED_FROM = ['sponsifable-v1', 'sponsorable-v1'] as const;

/**
 * Carry a save written before a rename across to the new key, once.
 *
 * The workspace file is the source of truth, but a creator who has only ever
 * run `npm run dev` has their work in this browser and nowhere else. Renaming
 * the key without this would strand it. Where both earlier names hold a save,
 * the later name's is the later work. The old keys are left where they are.
 */
export function adoptRenamedSave(): void {
  try {
    if (localStorage.getItem(SAVE_KEY) !== null) return;
    for (const key of RENAMED_FROM) {
      const older = localStorage.getItem(key);
      if (older === null) continue;
      localStorage.setItem(SAVE_KEY, older);
      return;
    }
  } catch {
    // Storage blocked. The app starts from the sample, as it would have anyway.
  }
}

adoptRenamedSave();

type SetState = StoreApi<State & Actions>['setState'];
/** Apply an immer recipe to the state. */
type Edit = (recipe: (s: State) => void) => void;

const editWith =
  (set: SetState): Edit =>
  (recipe) =>
    set(produce<State>(recipe));

/** Channels on the profile. Switching platform resets the format list. */
function channelActions(edit: Edit): Pick<Actions, 'addChannel' | 'updateChannel' | 'removeChannel'> {
  return {
    addChannel: (platform) =>
      edit((s) => {
        s.seq += 1;
        s.profile.channels.push({
          id: `ch-${s.seq}`,
          platform,
          handle: '',
          followers: 0,
          medianViews: 0,
          engagementRate: 0,
          formats: [...(FORMATS_BY_PLATFORM[platform] ?? [])],
        });
      }),
    updateChannel: (id, patch) =>
      edit((s) => {
        const channel = s.profile.channels.find((c) => c.id === id);
        if (!channel) return;
        Object.assign(channel, patch);
        // Switching platform invalidates the format list.
        if (patch.platform) channel.formats = [...(FORMATS_BY_PLATFORM[patch.platform] ?? [])];
      }),
    removeChannel: (id) =>
      edit((s) => {
        s.profile.channels = s.profile.channels.filter((c) => c.id !== id);
      }),
  };
}

/** The profile's own fields, its geography and its proof points. */
function profileActions(
  edit: Edit,
): Pick<Actions, 'updateProfile' | 'updateGeo' | 'addProofPoint' | 'updateProofPoint' | 'removeProofPoint' | 'setTerms'> {
  return {
    updateProfile: (patch) => edit((s) => void Object.assign(s.profile, patch)),
    updateGeo: (tier, value) => edit((s) => void (s.profile.geo[tier] = Math.max(0, value))),
    addProofPoint: () =>
      edit((s) => {
        s.seq += 1;
        s.profile.proofPoints.push({ id: `pp-${s.seq}`, label: '', result: '' });
      }),
    updateProofPoint: (id, patch) =>
      edit((s) => {
        const proof = s.profile.proofPoints.find((p) => p.id === id);
        if (proof) Object.assign(proof, patch);
      }),
    removeProofPoint: (id) =>
      edit((s) => {
        s.profile.proofPoints = s.profile.proofPoints.filter((p) => p.id !== id);
      }),
    setTerms: (patch) => edit((s) => void Object.assign(s.terms, patch)),
  };
}

/** A blank prospect in the creator's own category, still being researched. */
function blankProspect(id: string, niche: CreatorProfile['niche']): Prospect {
  return {
    id,
    brand: '',
    product: '',
    niche,
    contactName: '',
    contactEmail: '',
    budgetBand: [0, 0],
    sellsInto: ['tier1'],
    evidence: '',
    stage: 'researching',
    lastContactedOn: '',
    notes: '',
  };
}

/** The prospect list and the outreach composer's focus. */
function prospectActions(
  edit: Edit,
  set: SetState,
): Pick<Actions, 'addProspect' | 'updateProspect' | 'removeProspect' | 'openOutreach'> {
  return {
    addProspect: () =>
      edit((s) => {
        s.seq += 1;
        s.prospects.unshift(blankProspect(`pr-${s.seq}`, s.profile.niche));
      }),
    updateProspect: (id, patch) =>
      edit((s) => {
        const prospect = s.prospects.find((p) => p.id === id);
        if (prospect) Object.assign(prospect, patch);
      }),
    removeProspect: (id) =>
      edit((s) => {
        s.prospects = s.prospects.filter((p) => p.id !== id);
        if (s.activeProspectId === id) s.activeProspectId = null;
      }),
    openOutreach: (id) => set({ activeProspectId: id, tab: 'outreach' }),
  };
}

/** The deal log and each deal's sightings. */
function dealActions(
  edit: Edit,
): Pick<Actions, 'recordDeal' | 'updateDeal' | 'removeDeal' | 'addSighting' | 'removeSighting'> {
  return {
    recordDeal: (build) =>
      edit((s) => {
        s.seq += 1;
        const deal = build(`dl-${s.seq}`);
        if (!deal) return;
        s.deals.unshift(deal);
        const prospect = s.prospects.find((p) => p.id === deal.prospectId);
        if (prospect) prospect.stage = deal.outcome;
      }),
    updateDeal: (id, patch) =>
      edit((s) => {
        const deal = s.deals.find((d) => d.id === id);
        if (deal) Object.assign(deal, patch);
      }),
    removeDeal: (id) =>
      edit((s) => {
        s.deals = s.deals.filter((d) => d.id !== id);
      }),
    addSighting: (dealId, sighting) =>
      edit((s) => {
        const deal = s.deals.find((d) => d.id === dealId);
        if (!deal) return;
        s.seq += 1;
        deal.sightings.push({ ...sighting, id: `st-${s.seq}` });
      }),
    removeSighting: (dealId, sightingId) =>
      edit((s) => {
        const deal = s.deals.find((d) => d.id === dealId);
        if (deal) deal.sightings = deal.sightings.filter((x) => x.id !== sightingId);
      }),
  };
}

/** Navigation, and replacing the whole workspace at once. */
function workspaceActions(set: SetState): Pick<Actions, 'setTab' | 'importAll' | 'resetToSample'> {
  return {
    setTab: (tab) => set({ tab }),
    importAll: (workspace) =>
      set((s) => ({
        profile: workspace.profile,
        terms: workspace.terms,
        prospects: workspace.prospects,
        deals: workspace.deals,
        board: workspace.board,
        emblem: workspace.emblem,
        activeProspectId: null,
        seq: Math.max(s.seq, seqFloor(workspace)),
      })),
    resetToSample: () =>
      set({
        profile: SAMPLE_PROFILE,
        terms: DEFAULT_TERMS,
        prospects: SAMPLE_PROSPECTS,
        deals: [],
        board: DEFAULT_BOARD,
        emblem: DEFAULT_EMBLEM,
        activeProspectId: null,
      }),
  };
}

/**
 * Application state.
 *
 * The workspace file that `sponsifer serve` owns is the source of truth, and
 * `sync.ts` keeps this store and the file in step. This browser's copy is a
 * cache, and the whole save when the app runs without the server.
 *
 * Nothing leaves the machine: no account, no remote server, no analytics. A
 * creator's unreleased rates and prospect list are commercially sensitive, and
 * the simplest way to keep them private is to never transmit them.
 */
export const useStore = create<State & Actions>()(
  persist(
    (set) => {
      const edit = editWith(set);
      return {
        ...initialState,
        ...workspaceActions(set),
        ...profileActions(edit),
        ...channelActions(edit),
        ...prospectActions(edit, set),
        ...dealActions(edit),
        setBoard: (patch) => edit((s) => void Object.assign(s.board, patch)),
        setEmblem: (patch) => edit((s) => void Object.assign(s.emblem, patch)),
        setSponsorArt: (dealId, art) =>
          edit((s) => {
            const deal = s.deals.find((d) => d.id === dealId);
            if (deal) deal.sponsorArt = art;
          }),
      };
    },
    {
      // The format is tracked by `version`, and `migrate` upgrades anything
      // older. The key was renamed with the product; `adoptRenamedSave` carries
      // a save written under an earlier name across, once.
      name: SAVE_KEY,
      version: WORKSPACE_VERSION,
      migrate: (persisted, version) => migrate(persisted, version) as State & Actions,
      partialize: (s): Persisted => ({
        profile: s.profile,
        terms: s.terms,
        prospects: s.prospects,
        deals: s.deals,
        board: s.board,
        emblem: s.emblem,
        seq: s.seq,
      }),
    },
  ),
);
