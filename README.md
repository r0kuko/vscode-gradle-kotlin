# Gradle Kotlin Companion

A VS Code extension that brings a JetBrains-style Gradle / Kotlin-DSL
experience to Visual Studio Code, on top of (and complementing) the
official `gradle-java` extension.

Highlights:

- **Gradle Modules sidebar** — every module discovered from
  `settings.gradle(.kts)` is rendered as a tree with its tasks underneath,
  one click to run.
- **Reload Project lens** at the top of every `build.gradle.kts` /
  `settings.gradle.kts`, mirroring the JetBrains floating "Reload All
  Gradle Projects" toolbar.
- **`dependencies { … }` action** — a CodeLens above every `dependencies`
  block runs the `dependencies` task for the owning module so you can
  refresh resolution from where you are.
- **`libs.versions.toml` integration** — inline ghost-text version hints
  next to every `libs.x.y.z` reference in your build scripts, plus
  completion when typing `libs.` (libraries, plugins, bundles and
  versions).
- **Long-lived Gradle daemon, exposed to Copilot** — registers a
  Language-Model tool named **`gradle_run`** that the agent can call
  instead of spawning `./gradlew` from a terminal. Every call reuses the
  same Gradle daemon, so the agent no longer fires up multiple competing
  JVMs while iterating.

## Sample project

`sample/` contains a multi-module Kotlin/Gradle project (`:app`,
`:core`, `:modules:featureA`, `:modules:featureB`) wired up with a
`gradle/libs.versions.toml` version catalog. Open the `sample/` folder
to see the sidebar, code lenses and inlay hints in action.

## Development

```sh
bun install
bun run compile
bun run test
```

Tests use vitest with a stubbed `vscode` module so they run on plain
Node (and therefore on Bun too).

To regenerate icons from the JetBrains expui set:

```sh
bun run icon
```

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `gradleKotlin.gradleCommand` | _empty_ | Override the Gradle command. |
| `gradleKotlin.versionInlayHints.enabled` | `true` | Show ghost-text versions next to `libs.*`. |
| `gradleKotlin.codeLens.enabled` | `true` | Show top-of-file Reload / Dependencies lenses. |
| `gradleKotlin.daemon.enabled` | `true` | Keep a long-lived Gradle daemon for Copilot tool calls. |

## License

MIT.
