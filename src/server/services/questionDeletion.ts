/**
 * Question-bank delete keys preserve the composite `(id, question_group)` identity.
 * A missing separator is intentionally the old id-only format, which targets every
 * group carrying that id.
 */
export const QUESTION_DELETE_KEY_SEPARATOR = '|||';

export interface QuestionDeletionSelector {
  id: string;
  questionGroup?: string;
}

export function parseQuestionDeletionSelector(raw: unknown): QuestionDeletionSelector {
  const key = String(raw);
  const separatorIndex = key.indexOf(QUESTION_DELETE_KEY_SEPARATOR);
  const id = separatorIndex === -1 ? key : key.slice(0, separatorIndex);

  if (!id) {
    throw new Error('Question ID is required');
  }

  if (separatorIndex === -1) {
    return { id };
  }

  return {
    id,
    questionGroup: key.slice(separatorIndex + QUESTION_DELETE_KEY_SEPARATOR.length),
  };
}

export function questionDeletionKey(id: string | number, questionGroup: string | null | undefined): string {
  return `${String(id)}${QUESTION_DELETE_KEY_SEPARATOR}${questionGroup ?? ''}`;
}

/**
 * Groups are derived from their remaining questions rather than stored separately.
 * Blank groups are valid question identities but are not a named group shown in the UI.
 */
export function removedQuestionGroups(
  affectedGroups: Iterable<string | null | undefined>,
  remainingGroups: Iterable<string | null | undefined>,
): string[] {
  const remaining = new Set(
    [...remainingGroups].filter((group): group is string => typeof group === 'string' && group !== ''),
  );
  const removed = new Set<string>();

  for (const group of affectedGroups) {
    if (typeof group === 'string' && group !== '' && !remaining.has(group)) {
      removed.add(group);
    }
  }

  return [...removed].sort((left, right) => left.localeCompare(right));
}
