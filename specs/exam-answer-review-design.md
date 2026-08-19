# Exam Answer Review Without False Anti-Cheat Violations

## Problem

The regular exam keeps one Monaco editor instance while candidates move between
questions. When a candidate revisits an answered question, React supplies that
question's saved answer through the editor's controlled `value` prop.
`@monaco-editor/react` applies the new value with `executeEdits`, and Monaco emits a
content-change event with `isFlush: false`. The existing suspicious-paste detector
therefore mistakes a long saved answer for a new paste. One navigation can create a
warning; a later navigation or another prior violation can lock and auto-submit the
exam.

## Requirements

1. Candidates may use Previous, Next, or a numbered question button to revisit any
   assigned question while the exam is active.
2. Loading an answer from application state into Monaco must never create a
   `suspicious_paste` report, regardless of answer length or whether Monaco marks the
   event as a flush.
3. A user-originated single content insertion of at least 300 characters must still
   create the existing `suspicious_paste` report with its bounded preview and true
   length.
4. The fix belongs in the shared `CodeEditor`, so controlled value restoration is
   safe in both regular and Practice pages. It must not weaken clipboard command
   blocking, rapid-insertion forensics, violation thresholds, or server-side locking.
5. Regression coverage must reproduce the non-flush controlled-value event used by
   `@monaco-editor/react` and distinguish it from a user-originated large insertion.

## Acceptance checks

- Rerender `CodeEditor` with a different saved answer longer than 300 characters,
  emit the same non-flush replacement event as Monaco, and assert that
  `onSuspiciousPaste` is not called.
- Emit a user-originated insertion longer than 300 characters while the controlled
  prop still contains the previous answer and assert that `onSuspiciousPaste` is
  called once with the expected preview and length.
- Run the focused client regression test, the complete client test suite, frontend
  type-check, production build, and the project code harness against this spec.

## Non-goals

- No backend route, schema, lock threshold, or forensic event format changes.
- No relaxation of actual paste, clipboard, focus, fullscreen, recording, or other
  anti-cheat signals.
