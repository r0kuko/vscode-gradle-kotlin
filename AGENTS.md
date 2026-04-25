# Repo agent notes

This repository is a sibling of `vscode-kotlin-test-adapter` and
`vscode-kotlinx-coroutine`. They share the same toolchain (TypeScript +
vitest, packaged via `vsce` / `bun`).

When updating core modules in `src/`:

- Do **not** introduce dependencies on `vscode` from `gradle.ts`,
  `libs.ts` or `tasks.ts`. They must remain trivially unit-testable in
  plain Node. Anything that needs `vscode` lives in `extension.ts` or
  thin provider shims (`treeProvider.ts`, `codelens.ts`, `inlayHints.ts`,
  `completion.ts`, `daemon.ts`).
- Update `test/*.test.ts` for new behavior — tests run with `bun run test`
  (which delegates to vitest with a stubbed `vscode`).
- Public types exported from `gradle.ts` (`GradleModule`),
  `tasks.ts` (`GradleTask`) and `libs.ts` (`VersionCatalog`) are consumed
  by every provider — keep them backwards-compatible.

When changing the Gradle daemon / tool integration:

- Re-use the singleton `getDaemon()` from `daemon.ts`. Never spawn a fresh
  `./gradlew` for short-lived tasks; that's exactly what we are saving the
  user from.
- The Copilot language-model tool (`gradle_run`) must keep the same
  schema (`task`, `projectPath`, `args`) — it's referenced by name from
  user prompts.
