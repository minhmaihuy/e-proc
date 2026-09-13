# Question-group cleanup

## Scope

Question groups are derived from the non-empty `question_bank.question_group` values;
they are not persisted in a separate table. This change makes deletion reflect that
model immediately in the Question Bank UI while preserving the composite question
identity `(id, question_group)`.

## Requirements

- When deletion removes the final question with a non-empty group, `GET
  /api/admin/questions/question-groups` no longer returns that group and the delete
  response reports it in `removedQuestionGroups`.
- A grouped single delete and a grouped bulk delete must target only the requested
  `(id, question_group)` rows. The legacy id-only contract remains supported and
  intentionally targets every row with that id.
- Before a regular `admin` deletes anything, the server must confirm that every
  matched row is owned by that user. A duplicate id in another group must not make
  the ownership check ambiguous or permit a partial mutation.
- After a successful Question Bank deletion, the client reloads questions, modules,
  and question groups. If the current group filter is no longer available, it resets
  to the unfiltered view and returns to page one.
- Checkbox selection and React row keys use the same composite identity as deletion,
  so two groups may safely reuse an id.

## Non-goals

- No schema migration or physical group-delete endpoint is introduced: removing the
  last question is the only valid way to remove a derived group.
- Deleting an id without a group remains the backwards-compatible legacy behavior.

## Verification

- Unit-test key parsing and removal detection, including a duplicate id in two
  groups, a non-final delete, and the id-only compatibility case.
- Unit-test the client identity/filter helper and run backend/frontend type-checks,
  tenant regression tests, full build, and the repository harness.
