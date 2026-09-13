import { describe, expect, it } from 'vitest';
import { questionDeletionKey, selectedQuestionGroupAfterRefresh } from './questionIdentity';

describe('Question Bank composite identity', () => {
  it('keeps two questions with the same id in separate groups', () => {
    expect(questionDeletionKey({ id: '17', question_group: 'Set A' })).toBe('17|||Set A');
    expect(questionDeletionKey({ id: '17', question_group: 'Set B' })).toBe('17|||Set B');
  });

  it('clears an active group filter after its final question is deleted', () => {
    expect(selectedQuestionGroupAfterRefresh('Completed set', ['Still has questions'])).toBe('');
    expect(selectedQuestionGroupAfterRefresh('Still has questions', ['Still has questions'])).toBe('Still has questions');
  });
});
