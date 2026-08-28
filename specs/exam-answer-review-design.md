# Exam Answer Review Without False Anti-Cheat Violations

## Problem

The regular exam keeps one Monaco editor instance while candidates move between
questions. When a candidate revisits an answered question, React supplies that
question's saved answer through the editor's controlled `value` prop.
`@monaco-editor/react` applies the new value with `executeEdits`, and Monaco emits a
content-change event with `isFlush: false`. The existing suspicious-paste detector
therefore mistakes a long saved answer for a new paste. One navigation can create a
warning; a later navigation or another prior violation can lock and auto-submit the
exam. The controlled-value fix removes that false report, but the complete review
contract also needs to cover mouse navigation after editing and mouse-driven
clipboard commands. Monaco's standalone `addAction()` API registers a new action;
reusing a built-in clipboard action id does not replace Monaco's original context
menu command. Monaco-local commands also leave a second boundary uncovered: a
candidate can press a clipboard shortcut while focus is on the question, navigation,
or another part of the exam page rather than inside the answer editor.

## Requirements

1. Candidates may use Previous, Next, or a numbered question button to revisit any
   assigned question while the exam is active, edit it further, and navigate again.
   These in-page mouse clicks must not show an anti-cheat warning, report any
   violation, lock the exam, or submit it.
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
6. Genuine copy, cut, and paste attempts must remain blocked whether initiated by a
   Monaco keyboard shortcut or a native clipboard event from browser/mouse UI.
   Monaco's own context menu and the native context menu must not expose a mouse path
   around the block. A right-click alone is not a violation; an actual clipboard
   event remains a violation.
7. Navigation safety must come from correct event-source separation. Do not add a
   time-based exemption around question changes that could hide a real clipboard,
   tab, focus, fullscreen, or extension-panel violation.
8. While a regular or Practice exam is active, standard clipboard shortcuts must be
   prevented anywhere in the document and routed to the existing matching violation:
   Ctrl/Cmd+C and Ctrl+Insert as `copy_attempt`; Ctrl/Cmd+X and Shift+Delete as
   `cut_attempt`; Ctrl/Cmd+V (including Ctrl/Cmd+Shift+V and
   Cmd+Option+Shift+V) and Shift+Insert as `paste_attempt`.
9. Native copy/cut/paste events initiated through browser or mouse UI must receive the
   same whole-page protection. One physical action must not create duplicate network
   violation reports when both the document and Monaco can observe it.
10. Clipboard classification must not steal overlapping DevTools shortcuts:
    Ctrl+Shift+C and Cmd+Option+C remain `devtools_open`. Existing clipboard/global
    cooldowns, backend thresholds, and append-only violation logging remain unchanged.

## Acceptance checks

- Rerender `CodeEditor` with a different saved answer longer than 300 characters,
  emit the same non-flush replacement event as Monaco, and assert that
  `onSuspiciousPaste` is not called.
- Emit a user-originated insertion longer than 300 characters while the controlled
  prop still contains the previous answer and assert that `onSuspiciousPaste` is
  called once with the expected preview and length.
- Load two long answered questions, append a short update, and repeatedly click the
  numbered, Previous, and Next controls. Assert the update survives and no warning,
  violation report, lock, or submit occurs.
- Invoke Monaco's copy keyboard command and dispatch cancelable native copy/cut/paste
  events inside the editor. Assert each operation is prevented and routed to the
  matching clipboard-attempt callback. Assert the editor context menu is disabled.
- Dispatch every supported keyboard combination from a non-editor element and assert
  it is prevented and mapped to the expected violation. Repeat representative copy and
  paste shortcuts in both regular and Practice pages. Assert DevTools overlaps keep
  their existing classification and inactive pages install no blocking behavior.
- In a production browser build, edit both answers before cycling through every
  navigation control, wait beyond anti-cheat cooldowns, and assert zero violation and
  submit requests; then focus the question content and verify a real copy shortcut
  produces exactly one `copy_attempt` and no submit.
- Run the focused client regression test, the complete client test suite, frontend
  type-check, production build, and the project code harness against this spec.

## Non-goals

- No backend route, schema, lock threshold, or forensic event format changes.
- No relaxation of actual paste, clipboard, focus, fullscreen, recording, or other
  anti-cheat signals.
- No blanket question-navigation grace period or backend exception.
- No new violation type, key-content logging, or change to the three-second duplicate
  cooldown; the existing append-only event records the mapped attempt type and time.
