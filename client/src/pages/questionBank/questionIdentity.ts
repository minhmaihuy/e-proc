export const QUESTION_DELETE_KEY_SEPARATOR = '|||';

export interface QuestionIdentity {
  id: string | number;
  question_group?: string | null;
}

/** Matches the API's grouped bulk-delete key format. */
export function questionDeletionKey(question: QuestionIdentity): string {
  return `${String(question.id)}${QUESTION_DELETE_KEY_SEPARATOR}${question.question_group ?? ''}`;
}

/** A deleted final group must not leave the Question Bank filtered to zero stale rows. */
export function selectedQuestionGroupAfterRefresh(
  selectedQuestionGroup: string,
  availableQuestionGroups: readonly string[],
): string {
  return selectedQuestionGroup && !availableQuestionGroups.includes(selectedQuestionGroup)
    ? ''
    : selectedQuestionGroup;
}
