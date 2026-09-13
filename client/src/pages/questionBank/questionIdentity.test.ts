import { describe, expect, it } from 'vitest';
import {
  questionDeletionKey,
  questionGroupSummary,
  quizImportFiltersAfterSuccess,
  selectedQuestionGroupAfterRefresh,
} from './questionIdentity';

describe('Question Bank composite identity', () => {
  it('keeps two questions with the same id in separate groups', () => {
    expect(questionDeletionKey({ id: '17', question_group: 'Set A' })).toBe('17|||Set A');
    expect(questionDeletionKey({ id: '17', question_group: 'Set B' })).toBe('17|||Set B');
  });

  it('clears an active group filter after its final question is deleted', () => {
    expect(selectedQuestionGroupAfterRefresh('Completed set', ['Still has questions'])).toBe('');
    expect(selectedQuestionGroupAfterRefresh('Still has questions', ['Still has questions'])).toBe('Still has questions');
  });

  it('switches to an unfiltered Quiz view after a Quiz import', () => {
    expect(quizImportFiltersAfterSuccess()).toEqual({
      selectedModule: '',
      selectedQuestionGroup: '',
      selectedCategory: 'quiz',
      currentPage: 1,
    });
  });

  it('shows a group delete control only when the actor owns every question or is tenant admin', () => {
    const questions = [
      { question_group: 'Set A', uploaded_by: 7 },
      { question_group: 'Set A', uploaded_by: 9 },
    ];

    expect(questionGroupSummary('Set A', questions, false, 7)).toEqual({
      name: 'Set A',
      questionCount: 2,
      canDelete: false,
    });
    expect(questionGroupSummary('Set A', questions, true, 7).canDelete).toBe(true);
  });
});
