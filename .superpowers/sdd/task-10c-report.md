# Task 10c Report — pending and duplicate-submission semantics

## Scope lock

- Changed only template create, unified save/update, immediate section reorder, template delete, and Codex CLI `다시 확인` pending behavior in the Renderer.
- Preserved the exact `TemplatesApi.create`, `update`, `reorderSections`, and `delete` calls and signatures; no Main, Preload, IPC, shared contract, route, service, repository, database, or adapter changes.
- Preserved one `update(id, { name, sections })` CTA, reorder-only `reorderSections`, default-template immutability, 1–8 and one-`action_items` validation, safe in-use errors, provider selection/save semantics, all four Codex mappings, redaction, and available-state omission of troubleshooting/refresh.

## Root cause and implementation

The mutation and refresh handlers awaited promises without an operation lock. Descriptor generation prevented stale results from winning, but did not prevent duplicate calls. Controls also retained their normal labels and enabled state while work was pending.

- `TemplateEditor` now uses one `TemplateOperation` discriminated union and a synchronous ref guard. The union records create, save, delete, or the exact reorder section/direction. One `runOperation` helper acquires the lock and releases it in `finally`.
- `ProcessingProviderSettings` now uses one `ProviderOperation` state for provider persistence or Codex refresh, plus the same synchronous guard/finally pattern. Codex refresh still calls `listProcessingProviderDescriptors` through the existing callback path.
- All conflicting template controls disable during a mutation. Provider selectors and Codex refresh disable while refresh or provider persistence conflicts.
- Pending labels are `생성 중…`, `저장 중…`, `정렬 중…`, `삭제 중…`, and `확인 중…`; the template and Codex regions expose `aria-busy`.

## TDD and exact state transitions

Baseline focused suites passed 27/27. Deferred-promise RED then produced six intended failures while those 27 protected cases remained green: the five operations lacked their progress/disabled state, and refresh lacked rejection recovery semantics in its rendered region.

GREEN deferred coverage verifies:

- Create: `idle -> create pending -> resolved -> idle`; repeated Enter and save/delete conflicts leave `create` at exactly 1 call, `update`/`delete` at 0.
- Save: `idle -> save pending -> rejected -> idle`; repeated Enter leaves `update` at exactly 1 call, `create`/`delete` at 0, then the safe fallback alert appears and controls recover.
- Reorder: `idle -> exact section/direction pending -> resolved -> idle`; repeated Enter leaves `reorderSections` at exactly 1 call and `update` at 0.
- Delete: `idle -> delete pending -> rejected -> idle`; repeated Enter leaves `delete` at exactly 1 call, `create`/`update` at 0, retains the safe in-use translation, and restores controls.
- Codex refresh success: after the one intentional provider selection save, refresh adds exactly one descriptor call; repeated Enter adds none, `updateProcessingProviders` stays at exactly 1, selections stay `openai`/`codex_cli`, and controls recover.
- Codex refresh rejection: the refresh control, selectors, and `aria-busy` recover in `finally`; the fixed safe load error appears and the raw rejected path remains redacted.
- Inverse conflict: while provider save is deferred, Codex refresh is disabled and issues no descriptor refresh; it recovers after persistence and its existing descriptor refresh completes.

Focused final matrix: 9 files, 113/113 tests passed. The two directly changed unit files pass 34/34.

## UI Visual Fix Rule

1. **Reported pixels:** Pending template mutation and Codex refresh controls must visibly show progress, remain readable, and avoid clipping/overflow at 1200×800 and 640×800; default/available states remain unchanged.
2. **Rendering source:** `TemplateEditor.tsx` renders the four mutation labels and disabled/`aria-busy` states through the existing `Button`, `ActionBar`, and template layouts. `CodexCliStatus.tsx` renders `확인 중…`; `ProcessingProviderSettings.tsx` owns its operation state. Existing `globals.css` button and `app.css` template/troubleshooting rules render the pixels; no CSS correction was required.
3. **Verified visible change:** The real route-aware `App` held each of create/save/reorder/delete/refresh promises pending at 1200×800 and 640×800. For all five actual buttons, `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight`; each control was reachable in the viewport and `documentElement.scrollWidth <= innerWidth`. The full visual suite passed all 52 tests. Built Electron independently retained desktop save bounds `679.703125..727.703125` inside a 735px renderer and compact `scrollWidth=clientWidth=609`.
4. **Regression test:** `real pending operation labels remain unclipped without overflow at 1200x800` and the paired `640x800` case in `tests/visual/task10.visual.pw.ts`; deferred behavior cases are in `tests/unit/template-editor.test.tsx` and `tests/unit/processing-provider-settings.test.tsx`.

## Verification

- Focused template/settings/provider matrix: 9 files, 113 passed.
- Full Vitest before and after ABI restoration: 55 files, 570 passed, 1 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed.
- `npm run test:visual`: 52 passed.
- `npm run test:e2e`: 2 passed against the real built Electron app.
- `git diff --check`: passed.
- Native restoration signal after Electron: `NODE_ABI_RESTORED 127 function`.

## Scope review

Production changes are confined to the three Renderer feature files that own the requested operations. The two unit suites and two real-App visual files provide deferred and pixel regressions. No CSS, API, IPC, adapter, contract, routing, service, persistence, or unrelated feature file changed.
