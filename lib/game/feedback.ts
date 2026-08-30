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
