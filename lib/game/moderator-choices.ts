import { ROLE_CATALOG } from './catalog';
import type { ActionKind, PhaseKind, RoleKey } from './types';

/**
 * The moderator's record of every saved choice: each phase's votes and Night
 * actions, who made them, and whom they chose. It names every role, so it is
 * for the moderator console alone and must never reach a player response.
 */
export interface ChoicesPhaseInput {
  id: string;
  sequence: number;
  kind: PhaseKind;
  status: string;
}

export interface ChoicesActionInput {
  phaseId: string;
  actorId: string;
  kind: ActionKind;
  targetIds: string[];
}

export interface ChoicesSeatInput {
  id: string;
  displayName: string;
  role: RoleKey | null;
}

export interface ChoiceTarget {
  id: string;
  displayName: string;
  role: string | null;
}

export interface PlayerChoice {
  actorId: string;
  actorName: string;
  actorRole: string | null;
  kind: ActionKind;
  /** What the choice was, e.g. "Investigated". */
  label: string;
  targets: ChoiceTarget[];
}

export interface PhaseChoices {
  phaseId: string;
  sequence: number;
  kind: PhaseKind;
  status: string;
  choices: PlayerChoice[];
}

/** The order choices are listed in within a phase: Night roles first, then ballots. */
const KIND_ORDER: ActionKind[] = ['WOLF_VOTE', 'INVESTIGATE', 'PROTECT', 'CUPID_PAIR', 'HUNTER_SHOT', 'DAY_VOTE', 'AFTERLIFE_VOTE'];

const KIND_LABEL: Record<ActionKind, string> = {
  WOLF_VOTE: 'Pack target',
  INVESTIGATE: 'Investigated',
  PROTECT: 'Protected',
  CUPID_PAIR: 'Linked as lovers',
  HUNTER_SHOT: 'Hunter’s shot',
  DAY_VOTE: 'Voted for',
  AFTERLIFE_VOTE: 'Afterlife tiebreak vote',
};

function roleName(role: RoleKey | null | undefined): string | null {
  return role ? ROLE_CATALOG[role]?.name ?? role : null;
}

/**
 * Groups the current choice of each player (one per action kind) by phase,
 * newest phase first. Within a phase, Night roles come first, then ballots, each
 * sorted by the chooser's name. Actions for an unknown phase are left out; an
 * unknown seat is shown as "Unknown player" so nothing saved is hidden.
 */
export function buildModeratorChoices(input: {
  phases: ChoicesPhaseInput[];
  actions: ChoicesActionInput[];
  seats: ChoicesSeatInput[];
}): PhaseChoices[] {
  const seats = new Map(input.seats.map((seat) => [seat.id, seat]));
  const byPhase = new Map<string, PlayerChoice[]>(input.phases.map((phase) => [phase.id, []]));
  for (const action of input.actions) {
    const list = byPhase.get(action.phaseId);
    if (!list) continue;
    const actor = seats.get(action.actorId);
    list.push({
      actorId: action.actorId,
      actorName: actor?.displayName ?? 'Unknown player',
      actorRole: roleName(actor?.role),
      kind: action.kind,
      label: KIND_LABEL[action.kind] ?? action.kind,
      targets: action.targetIds.map((targetId) => {
        const target = seats.get(targetId);
        return { id: targetId, displayName: target?.displayName ?? 'Unknown player', role: roleName(target?.role) };
      }),
    });
  }
  const order = (kind: ActionKind) => {
    const index = KIND_ORDER.indexOf(kind);
    return index === -1 ? KIND_ORDER.length : index;
  };
  return [...input.phases]
    .sort((a, b) => b.sequence - a.sequence)
    .map((phase) => ({
      phaseId: phase.id,
      sequence: phase.sequence,
      kind: phase.kind,
      status: phase.status,
      choices: (byPhase.get(phase.id) ?? []).sort((a, b) =>
        order(a.kind) - order(b.kind) || a.actorName.localeCompare(b.actorName, undefined, { sensitivity: 'base' })),
    }));
}
