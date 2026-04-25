# Repo agent notes

This repository is a sibling of `vscode-kotlin-test-adapter` and
`vscode-kotlinx-coroutine`. They share the same toolchain (TypeScript +
vitest, packaged via `vsce` / `bun`).

When updating core modules in `src/`:

- Do **not** introduce dependencies on `vscode` from the **pure-Node**
  modules. They must remain trivially unit-testable with plain
  vitest:
  - `gradle.ts`, `libs.ts`, `tasks.ts`, `history.ts`, `settingsEdit.ts`,
    `latestVersion.ts`, `testDiscovery.ts`, `junitReport.ts`,
    `argSplit.ts`, `buildDiagnostics.ts`, `wrapper.ts`.
  Anything that needs `vscode` lives in `extension.ts` or thin provider
  shims (`treeProvider.ts`, `codelens.ts`, `inlayHints.ts`,
  `completion.ts`, `daemon.ts`, `testController.ts`, `aiTool.ts`,
  `statusBar.ts`).
- Update `test/*.test.ts` for new behavior — tests run with `bun run test`
  (which delegates to vitest with a stubbed `vscode`, `pool: 'forks'`).
- Public types exported from `gradle.ts` (`GradleModule`),
  `tasks.ts` (`GradleTask`) and `libs.ts` (`VersionCatalog`) are consumed
  by every provider — keep them backwards-compatible.

When changing the Gradle daemon / tool integration:

- Re-use the singleton `getDaemon()` from `daemon.ts`. Never spawn a fresh
  `./gradlew` for short-lived tasks; that's exactly what we are saving the
  user from.
- `DaemonRunRequest.onOutput` is the supported way for UI layers to
  observe live stdout/stderr (e.g. progress messages); do not bypass it
  with bespoke `cp.spawn` calls.
- The Copilot language-model tools (`gradle_run`, `gradle_dependencies`)
  must return the structured `{ invocation, exitCode, durationMs,
  truncated, bytes, tail }` payload built by `buildRunPayload` in
  `aiTool.ts`. Do not regress to plain markdown.
