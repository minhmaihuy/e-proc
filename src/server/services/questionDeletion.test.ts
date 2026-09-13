import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuestionDeletionAuthorized,
  parseQuestionDeletionSelector,
  questionDeletionKey,
  removedQuestionGroups,
} from './questionDeletion.js';

test('grouped delete keys retain the group when ids overlap', () => {
  const selector = parseQuestionDeletionSelector(questionDeletionKey('same-id', 'Set B'));

  assert.deepEqual(selector, { id: 'same-id', questionGroup: 'Set B' });
});

test('id-only delete keys retain the legacy all-groups selector', () => {
  assert.deepEqual(parseQuestionDeletionSelector('same-id'), { id: 'same-id' });
});

test('last non-empty group is reported while groups with remaining questions are retained', () => {
  assert.deepEqual(
    removedQuestionGroups(['Completed set', 'Still has questions', ''], ['Still has questions']),
    ['Completed set'],
  );
});

test('empty question ids are rejected before a delete query can be made', () => {
  assert.throws(() => parseQuestionDeletionSelector('|||Set A'), /Question ID is required/);
});

test('group-wide deletion is all-or-nothing for a regular admin', () => {
  const rows = [{ uploaded_by: 7 }, { uploaded_by: 9 }];

  assert.equal(isQuestionDeletionAuthorized(rows, { id: 7, role: 'admin' }), false);
  assert.equal(isQuestionDeletionAuthorized([{ uploaded_by: 7 }], { id: 7, role: 'admin' }), true);
  assert.equal(isQuestionDeletionAuthorized(rows, { id: 7, role: 'tenant_admin' }), true);
});
