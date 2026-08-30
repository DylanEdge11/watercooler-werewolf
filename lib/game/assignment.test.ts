import { describe, expect, it } from 'vitest';
import { defaultComposition } from './balance';
import { createAssignmentPreview } from './assignment';

describe('role assignment', () => {
  it('assigns every role exactly once per configured seat and records evidence', async () => {
    const seats = Array.from({ length: 20 }, (_, index) => `seat-${String(index).padStart(2, '0')}`);
    const preview = await createAssignmentPreview(
      seats,
      defaultComposition(20),
      Array.from({ length: 19 }, (_, index) => ((index * 37) % 100) / 100),
    );
    expect(preview.assignments).toHaveLength(20);
    expect(new Set(preview.assignments.map((item) => item.seatId)).size).toBe(20);
    expect(preview.assignments.filter((item) => item.role === 'HUNTER')).toHaveLength(1);
    expect(preview.assignments.filter((item) => item.role === 'MASON')).toHaveLength(2);
    expect(preview.evidenceHash.length).toBeGreaterThan(30);
  });

  it('replays to an identical result with the same rolls', async () => {
    const seats = Array.from({ length: 20 }, (_, index) => `seat-${index}`);
    const rolls = Array.from({ length: 19 }, () => 0.42);
    const first = await createAssignmentPreview(seats, defaultComposition(20), rolls);
    const replay = await createAssignmentPreview(seats, defaultComposition(20), rolls);
    expect(replay).toEqual(first);
  });
});

