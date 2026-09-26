export interface PilotFeedbackInput {
  rating: unknown;
  comment?: unknown;
}

export interface ValidPilotFeedback {
  rating: number;
  comment: string | null;
}

export function validatePilotFeedback(input: PilotFeedbackInput): ValidPilotFeedback {
  if (!Number.isInteger(input.rating) || Number(input.rating) < 1 || Number(input.rating) > 5) {
    throw new Error('Feedback rating must be a whole number from 1 to 5.');
  }
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (comment.length > 2_000) throw new Error('Feedback comment must be 2,000 characters or fewer.');
  return { rating: Number(input.rating), comment: comment || null };
}

export interface FeedbackEntry {
  rating: number;
  comment: string | null;
  respondentType: 'PLAYER' | 'MODERATOR';
  createdAt: string;
}

export interface FeedbackSummary {
  count: number;
  /** Mean rating to one decimal place, or null when nothing was sent. */
  average: number | null;
  entries: FeedbackEntry[];
}

/** What the moderator's Feedback block shows. Entries never carry who sent them. */
export function summarizeFeedback(rows: FeedbackEntry[]): FeedbackSummary {
  const entries = rows
    .map(({ rating, comment, respondentType, createdAt }) => ({ rating: Number(rating), comment: comment ?? null, respondentType, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const average = entries.length
    ? Math.round((entries.reduce((sum, entry) => sum + entry.rating, 0) / entries.length) * 10) / 10
    : null;
  return { count: entries.length, average, entries };
}
