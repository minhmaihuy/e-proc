export const QUESTION_DELETE_KEY_SEPARATOR = '|||';

export interface QuestionIdentity {
  id: string | number;
  question_group?: string | null;
}

export interface QuestionGroupQuestion {
  question_group?: string | null;
  uploaded_by?: string | number | null;
}

export interface QuestionGroupSummary {
  name: string;
  questionCount: number;
  canDelete: boolean;
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

/** Mirrors the server's all-rows ownership rule for a group delete control. */
export function questionGroupSummary(
  group: string,
  questions: readonly QuestionGroupQuestion[],
  isTenantAdmin: boolean,
  userId: number | null,
): QuestionGroupSummary {
  const groupQuestions = questions.filter((question) => (question.question_group ?? '') === group);
  const canDelete = isTenantAdmin || (
    userId !== null
    && groupQuestions.length > 0
    && groupQuestions.every((question) => String(question.uploaded_by) === String(userId))
  );

  return { name: group, questionCount: groupQuestions.length, canDelete };
}
