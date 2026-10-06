import { describe, expect, test } from 'vitest';
import { COULD_NOT_REACH, plainError } from './plain-error';

describe('plainError', () => {
  test('a network failure becomes one plain sentence, not the browser\'s wording', () => {
    expect(plainError(new TypeError('Failed to fetch'), 'Unable to send.')).toBe(COULD_NOT_REACH);
    expect(plainError(new TypeError('NetworkError when attempting to fetch resource.'), 'Unable to send.')).toBe(COULD_NOT_REACH);
  });

  test('a reply that is not JSON becomes the same sentence', () => {
    expect(plainError(new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"), 'Unable to send.')).toBe(COULD_NOT_REACH);
  });

  test('an error the app wrote keeps its own text', () => {
    expect(plainError(new Error('This phase is closed.'), 'Unable to send.')).toBe('This phase is closed.');
  });

  test('something that is not an error, or has no message, falls back', () => {
    expect(plainError('boom', 'Unable to send.')).toBe('Unable to send.');
    expect(plainError(new Error(''), 'Unable to send.')).toBe('Unable to send.');
  });

  test('the sentence is the approved wording', () => {
    expect(COULD_NOT_REACH).toBe('That didn’t go through. Check your connection and try again.');
  });
});
