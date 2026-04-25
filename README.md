# Gradle Kotlin Companion

A VS Code extension that brings a JetBrains-style Gradle / Kotlin-DSL
experience to Visual Studio Code, on top of (and complementing) the
official `gradle-java` extension.

## Highlights

### Modules & tasks
- **Gradle Modules sidebar** — every module discovered from
  `settings.gradle(.kts)` is rendered as a tree with its tasks underneath.
  Each task gets three inline buttons: **Run**, **Run with arguments…**,
  and **Run tests…** (filter by `--tests` pattern).
- **`tasks --all` merge** — after the static scan, the extension also
  invokes `:module:tasks --all --quiet` per module via the shared daemon
  and merges the results, so dynamically-registered tasks appear in the
  tree too.
- **Recent runs folder** at the top of the sidebar — every task you run
  from the UI is recorded; one click re-runs it with the same arguments.
  Use **Gradle: Clear Recent Runs** from the view title bar to wipe.

### Build script integration
- **Reload Project lens** at the top of every `build.gradle.kts` /
  `settings.gradle.kts`, mirroring the JetBrains floating "Reload All
  Gradle Projects" toolbar.
- **`dependencies { … }` action** — a CodeLens above every `dependencies`
  block runs the `dependencies` task for the owning module so you can
  refresh resolution from where you are.
- **Add Subproject quick fix** — in `settings.gradle(.kts)`, an editor
  CodeAction prompts for a path and writes a `include(":new-module")`
  line plus a default `build.gradle.kts` skeleton.

### Version catalog (`libs.versions.toml`)
- Inline ghost-text version hints next to every `libs.x.y.z` reference
  in your build scripts. With `gradleKotlin.versionInlayHints.checkLatest`
  enabled (default) the extension queries Maven Central and renders
  `current -> latest` when an upgrade is available.
- Completion when typing `libs.` covers libraries, plugins, bundles and
  versions.
- **Go to Definition** (Cmd/Ctrl+click) and **Hover** on `libs.x.y`
  jump to / preview the matching entry in `libs.versions.toml`.

### Test Explorer
- Kotlin classes under `src/test/kotlin/**` containing `@Test` methods
  are surfaced in the **Testing** view, grouped per module.
- Running an item (whole module, class, or method) dispatches
  `:module:test --tests <pattern>` through the shared daemon and parses
  `build/test-results/test/*.xml` to mark each case passed / failed /
  skipped with timing.

### Status bar & cancellation
- A small **`$(rocket) Gradle`** item on the left shows the daemon
  state. While a task is running it switches to `$(sync~spin) Gradle:
  <task>`. Click it to stop the daemon.
- All UI-initiated runs show a cancellable notification — pressing the
  ✕ SIGTERMs the underlying gradle child.

### Long-lived Gradle daemon, exposed to Copilot
The extension keeps a single daemon shared by every command and exposes
four Language-Model tools so Copilot can drive Gradle without spawning
its own JVMs:

| Tool reference | Purpose |
| --- | --- |
| `#gradle` (`gradle_run`) | Run any task with optional args. |
| `#gradleTasks` (`gradle_tasks`) | Bulleted list of tasks under a project path. |
| `#gradleDependencies` (`gradle_dependencies`) | Dependency tree for a project path. |
| `#libsCatalog` (`libs_catalog_read`) | Parsed `libs.versions.toml` as JSON. |

An init script (`resources/gradle-kotlin.init.gradle.kts`) is injected
via `-I` for every invocation; disable with
`gradleKotlin.initScript.enabled = false` or point to your own with
`gradleKotlin.initScriptPath`.

## Sample project

`sample/` contains a multi-module Kotlin/Gradle project (`:app`,
`:core`, `:modules:featureA`, `:modules:featureB`) wired up with a
`gradle/libs.versions.toml` version catalog. Open the `sample/` folder
to see the sidebar, code lenses, inlay hints and Test Explorer in
action.

## Commands

| Command | Default location |
| --- | --- |
| `Gradle: Refresh Modules` | View title `$(refresh)` |
| `Gradle: Reload Project` | View title + editor title |
| `Gradle: Run Task` | Tree item inline `$(play)` |
| `Gradle: Run Task with Arguments…` | Tree item inline `$(edit)` |
| `Gradle: Run Tests in Task…` | Tree item inline `$(beaker)` |
| `Gradle: Re-run Recent` | Recent-runs item `$(debug-rerun)` |
| `Gradle: Clear Recent Runs` | View title `$(trash)` |
| `Gradle: Show Dependencies` | CodeLens above `dependencies { }` |
| `Gradle: Add Subproject…` | CodeAction in `settings.gradle(.kts)` |
| `Gradle: Open Module Build File` | Module item context |
| `Gradle: Stop Daemon` | Status-bar click |

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `gradleKotlin.gradleCommand` | _empty_ | Override the Gradle command. |
| `gradleKotlin.versionInlayHints.enabled` | `true` | Show ghost-text versions next to `libs.*`. |
| `gradleKotlin.versionInlayHints.checkLatest` | `true` | Query Maven Central and surface `current -> latest`. |
| `gradleKotlin.codeLens.enabled` | `true` | Show top-of-file Reload / Dependencies lenses. |
| `gradleKotlin.daemon.enabled` | `true` | Keep a long-lived Gradle daemon for Copilot tool calls. |
| `gradleKotlin.initScript.enabled` | `true` | Inject an init script via `-I` for every daemon invocation. |
| `gradleKotlin.initScriptPath` | _empty_ | Override the init script path; defaults to the bundled one. |

## Development

```sh
bun install
bun run compile
bun run test       # vitest unit tests with stubbed `vscode`
bun run test:e2e   # @vscode/test-electron smoke test (downloads VS Code)
```

To regenerate icons from the JetBrains expui set:

```sh
bun run icon
```

## License

MIT.
