import { describe, expect, it } from 'vitest';
import { CONCEALED_ACTION_LABEL, concealedPermission, parseRoleVisibility, roleVisibilityCookieValue } from './role-visibility';

describe('role visibility cookie', () => {
  it('round-trips a seat’s choice', () => {
    expect(parseRoleVisibility(roleVisibilityCookieValue('seat-1', true), 'seat-1')).toBe(true);
    expect(parseRoleVisibility(roleVisibilityCookieValue('seat-1', false), 'seat-1')).toBe(false);
  });

  it('ignores a missing, malformed, or other seat’s cookie', () => {
    expect(parseRoleVisibility(undefined, 'seat-1')).toBeNull();
    expect(parseRoleVisibility('seat-2.hidden', 'seat-1')).toBeNull();
    expect(parseRoleVisibility('seat-1.maybe', 'seat-1')).toBeNull();
    expect(parseRoleVisibility('hidden', 'seat-1')).toBeNull();
  });
});

describe('the ballot while the role is hidden', () => {
  const day = { kind: 'DAY', status: 'OPEN' };
  const night = { kind: 'NIGHT', status: 'OPEN' };

  it('keeps the Day vote and the Afterlife vote, which every eligible player has', () => {
    const dayVote = { actionKind: 'DAY_VOTE', maxTargets: 1, label: 'Cast your village ballot' };
    expect(concealedPermission(dayVote, day, true)).toEqual({ permission: dayVote, masked: false });
    const afterlifeVote = { actionKind: 'AFTERLIFE_VOTE', maxTargets: 1, label: 'Optional Afterlife tiebreak vote' };
    expect(concealedPermission(afterlifeVote, day, false)).toEqual({ permission: afterlifeVote, masked: false });
  });

  it('hides every role action, and looks the same at Night whether or not the player has one', () => {
    const wolves = concealedPermission({ actionKind: 'WOLF_VOTE', maxTargets: 1, label: 'Choose the pack targets' }, night, true);
    const villager = concealedPermission({ actionKind: null, maxTargets: 0, label: 'No private action this night' }, night, true);
    expect(wolves).toEqual({ permission: { actionKind: null, maxTargets: 0, label: CONCEALED_ACTION_LABEL }, masked: true });
    expect(villager).toEqual(wolves);
    const hunter = concealedPermission({ actionKind: 'HUNTER_SHOT', maxTargets: 1, label: 'Choose your final target' }, { kind: 'DAY', status: 'PENDING_HUNTER' }, false);
    expect(hunter.masked).toBe(true);
  });

  it('leaves waiting states that every player shares', () => {
    const review = { actionKind: null, maxTargets: 0, label: 'Waiting for moderator review' };
    expect(concealedPermission(review, { kind: 'NIGHT', status: 'PENDING_APPROVAL' }, true).masked).toBe(false);
    expect(concealedPermission({ actionKind: null, maxTargets: 0, label: 'Spectating the village' }, night, false).masked).toBe(false);
    expect(concealedPermission({ actionKind: null, maxTargets: 0, label: 'Waiting for the moderator' }, null, true).masked).toBe(false);
  });
});
