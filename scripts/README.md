# Repository scripts

Use the stable package scripts from the repository root. See
[development](../docs/development.md) for validation and ownership.

| Directory    | Contents and package entrypoints                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `build/`     | Engine/site and npm packaging: `build`, `build:engine`, `build:package`.                                     |
| `dev/`       | Local server and rebuild loop: `dev`.                                                                        |
| `songs/`     | Canonical song checking/formatting and offline WAV rendering: `songs:check`, `songs:fmt`, `render`.          |
| `fidelity/`  | Reproducible audio checkpoints and RMS-matched local audition pages: `fidelity:capture`, `fidelity:compare`. |
| `checks/`    | Repository lint/policy checks and fixtures.                                                                  |
| `git/hooks/` | Tracked hook bodies; installation and drift checks use agent-tool.                                           |
| `testing/`   | The full validation run-group plan used by `check`, and the Chrome every browser suite launches.             |

Update imports, relative root resolution, package commands, CI, hooks, tests, and
documentation when moving a script. Keep the product-specific song/audio adapters
here; shared workflow mechanics belong in agent-tool.
