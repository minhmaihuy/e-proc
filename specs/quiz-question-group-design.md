# Quiz QuestionGroup import

## Scope

Quiz questions share `question_bank` with essay/coding questions and are uniquely identified by
`(id, question_group)`. This change makes the group explicit in every Quiz source and ensures an
admin can immediately see successfully imported Quiz rows.

## Requirements

- The Question Bank file picker accepts `.csv`, `.xlsx`, and `.xls` for Quiz imports.
- The canonical Quiz header order is `ID, Type, Level, Topic, QuestionGroup, Question Sample,
  Option A` through `Option F`, `Correct, Score`.
- `QuestionGroup` is mandatory for Quiz imports. The backend accepts the compatible aliases
  `Question Group`, `Question Set`, and `Bộ đề`, but rejects a source with no recognized header
  before writing any row and skips/reports a row whose group is blank.
- Essay/coding import retains its legacy optional group behavior; this change must not turn old
  essay sources into invalid imports.
- A successful Quiz import resets module and group filters, chooses the Quiz category, clears row
  selection, and returns to page one before the Question Bank refresh completes.

## Verification

- Source-lock the Quiz header/value validation and composite upsert identity.
- Unit-test the post-import filter state.
- Validate a representative CSV has a `QuestionGroup` header and a non-empty value for every data
  row, then run backend/frontend type checks, relevant tests, documentation sync, and the harness.
