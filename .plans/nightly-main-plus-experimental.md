# Nightly Main Plus Experimental Integration

Status: DONE

Last updated: 2026-07-24

## Purpose and branch contract

`nightly/main-plus-experimental` is a long-lived personal integration branch for testing selected
upstream work before it reaches `pingdotgg/t3code:main`.

- Upstream baseline: `origin/main` (`pingdotgg/t3code`)
- Publication target: `fork/nightly/main-plus-experimental` (`keeperxy/t3code`)
- Update policy: merge upstream refs; never rebase or force-push the published branch
- Direction: merge `origin/main` and selected upstream feature heads into this branch, never this
  branch into upstream `main`
- History policy: retire replaced local code in normal follow-up commits; do not rewrite history
- Scope policy: this branch is intentionally allowed to carry draft upstream architecture, but every
  retained divergence must have an owner, verification entry, and retirement rule below

## Current baseline

| Source | Integrated ref | Last checked | State |
| --- | --- | --- | --- |
| `origin/main` | `bb38c3320d0a4eec4e9097fdc400970d881ff559` | 2026-07-24 | Integrated by `631809152` |
| Integration branch | `38f1cdc26e82fc1752270426ca7fc6c9f95d2776` | 2026-07-24 | Current compatibility implementation and Apple build source |
| PR #2829 | `7732874f501e48f74b19866c95a086af7b1ee6ad` | 2026-07-24 | Draft, conflicting upstream; refreshed by `4fc842fc0` |
| PR #3558 | `21bf9696b29117c90e18f05bd8043c8fed5d9c9c` | 2026-07-24 | Closed without merge; V2-native replacement integrated |
| PR #3638 | merge commit `dac514e6b6237c07e9ab3c5415e97472a96926b2` | 2026-07-24 | Integrated through PR #2829; not present on upstream `main` |
| Issue #3164 | open | 2026-07-24 | Cron/prompt MVP integrated; external event triggers remain upstream scope |

The implementation, first-publication verification, and remote publication are complete.
`fork/nightly/main-plus-experimental` is the durable integration ref.

## Feature ledger

### PR #2829 - Orchestrator V2

- Status: DONE
- Strategy: merge the complete upstream feature head, then preserve newer `main` behavior through
  focused V2 ports
- Reason for the full integration: the requested scheduler from PR #3638 is implemented against
  Orchestrator V2. A smaller subagent-only port would not provide scheduled tasks and would require a
  second scheduler architecture.
- Included behavior: V2 runs/nodes/provider threads, nested subagents, fork and merge-back,
  cross-provider handoff, server-side queued runs, provider switching, Orchestrator MCP tools, and V2
  web/mobile projections.
- Upstream caveat: PR #2829 remains a large conflicting draft. Its own CI and open TODOs are not
  treated as proof that this branch is release-ready.
- Main compatibility port required by the first merge: PR #4026 server-backed thread settlement must
  remain available on V2 instead of restoring the deleted V1 runtime.
- Update watchlist: the PR head, its migration sequence, provider adapters, V2 contracts, projections,
  `ChatView`, mobile thread presentation, and the lockfile.
- Retirement: mark `ADOPTED_UPSTREAM` when Orchestrator V2 or an equivalent architecture reaches
  `main`; merge `main`, remove only genuinely duplicate local glue, and rerun the full matrix.

### PR #3558 - Codex `/review` and `/compact`

- Status: DONE
- Strategy: reimplement on `CodexAdapterV2`; do not cherry-pick deleted V1 adapter files.
- Required behavior:
  - advertise `/review` and `/compact` only after a successful Codex app-server probe
  - accept only standalone, attachment-free commands
  - map `/review [instructions]` to `review/start`
  - map `/compact` to `thread/compact/start` and correlate its `turn/started` notification
  - preserve normal orchestration run lifecycle and failure handling
- Update watchlist: app-server protocol generation pin, command RPC schemas, Codex provider snapshot,
  adapter session multiplexing, and compact notification timeout/cleanup behavior.
- Local implementation: `8919694ea`; `/compact` has a 30-second `turn/started` timeout and always
  clears pending correlation state on success, timeout, or RPC failure.
- Retirement: remove the local port only when upstream `main` has equivalent V2 command routing and
  focused tests.

### Native Codex `/goal`

- Status: DONE
- Strategy: local V2-native implementation using `thread/goal/get|set|clear`; never send `/goal` as
  ordinary prompt text.
- Required behavior:
  - `/goal` opens or displays the current goal
  - `/goal <objective>` sets or replaces the objective
  - `/goal edit`, `/goal pause`, `/goal resume`, and `/goal clear` use explicit goal operations
  - goal operations do not create an orchestration run because Codex goal RPCs do not create turns
  - goal objective, status, budget, token use, and elapsed time remain visible in the thread UI
  - provider notifications update the durable V2 projection
- Update watchlist: Codex goals feature flag, native-thread-to-app-thread routing, provider session
  reuse, projection replay, and draft threads without a materialized native Codex thread.
- Local implementation:
  - `8919694ea`: canonical goal schema, durable projection/replay, stale-event tombstone, and
    migration 42
  - `95dafb0e0`: Codex goal RPC adapter, provider notifications, and centralized persistence
  - `617e948be`: serialized, idempotent no-run thread goal service
  - `6bd14fd4c`: WebSocket RPC and client-runtime operations
  - `4e03d417b`: Web command parser, dialog, header badge, and thread-details controls
- Client scope: `/goal` is a Web built-in for materialized Codex threads. It is deliberately not
  advertised as a provider-wide command, so Mobile cannot accidentally send `/goal` as ordinary
  prompt text. A native Mobile goal UI is a separate future update.
- Retirement: adopt an upstream native goal implementation only after verifying that it does not
  regress persisted display or no-run command semantics.

### Issue #3164 / PR #3638 - Scheduled prompts

- Status: DONE
- Strategy: retain the complete scheduled-task implementation already merged into PR #2829.
- Included behavior: project-scoped prompt, interval or fixed local-server time with weekday mask,
  model/runtime/workspace selection, persistence, enable/pause, run-now, live status, MCP tools, new
  thread or bound-thread execution, and restart recovery.
- Required local hardening:
  - scope project selection to the active environment
  - distinguish loading, empty, and error states
  - show the project for every task
  - expose direct pause/resume and confirmed delete actions
  - state that fixed times use the server timezone
  - prefer the selected project's default model
- Accepted MVP limits:
  - one server process owns scheduling; there is no cross-instance database lease
  - `succeeded` means dispatch succeeded, not that the agent's work completed successfully
  - no run-history table or execution-level overlap policy
  - fixed times use the server timezone
  - no GitHub, GitLab, Sentry, Linear, Jira, or Slack event triggers
- Follow-up update: if issue #3164 gains event triggers upstream, evaluate them as a separate ledger
  entry rather than expanding the cron MVP implicitly.
- Retirement: mark `ADOPTED_UPSTREAM` when scheduled tasks reach `main`; retain only hardening that is
  still missing upstream.

## Compatibility decisions from the first integration

1. Main migration 33 (`ProjectionThreadsSettled`) remains immutable. Its source filename is
   `041_ProjectionThreadsSettled.ts`, but the registry ID remains 33. The PR #2829 migrations that
   originally used IDs 33 through 40 are registered as 34 through 41. Their upstream filenames remain
   unchanged to keep future feature-head merges reviewable. Local goal migration file 41 is
   registered as database migration 42. `Migrations.ts` is the authoritative ID mapping.
2. Deleted V1 orchestration adapters, reducers, and large V1 test seams stay deleted. Newer `main`
   behavior is ported to V2 instead of reviving two runtimes.
3. PR #4026 thread settlement is a required main-compatibility invariant. Thread settle/unsettle,
   activity wake-up, shell fields, persistence, and current Sidebar V2 behavior must all remain.
4. The newer `main` branch-drift detection, PR discovery, server-update UI, provider defaults,
   composer disconnect behavior, mobile working timer, and project context remain in the merged V2
   clients.
5. Scheduled tasks keep the upstream `interval | fixed_time` model. No parallel Cron parser or
   second scheduler is added to this branch.

## Upstream update procedure

Run this sequence from a clean checkout:

```sh
git fetch --prune origin
git fetch --prune fork
git switch nightly/main-plus-experimental
git status --short --branch
git merge --no-ff origin/main -m "Merge origin/main into nightly/main-plus-experimental"
```

Then refresh the selected upstream work before local ports:

```sh
gh pr view 2829 --repo pingdotgg/t3code --json state,headRefOid,mergeable,updatedAt
gh pr view 3558 --repo pingdotgg/t3code --json state,headRefOid,updatedAt
gh pr view 3638 --repo pingdotgg/t3code --json state,headRefOid,mergedAt
gh issue view 3164 --repo pingdotgg/t3code --json state,updatedAt
git fetch origin '+refs/pull/2829/head:refs/remotes/origin/pr-2829'
git merge --no-ff origin/pr-2829 -m "Merge updated PR 2829 into nightly integration"
```

After every merge:

1. Update the baseline and source SHAs in this plan.
2. Check whether upstream now contains any local port completely or partially.
3. Resolve conflicts using the feature invariants above, not an unconditional ours/theirs choice.
4. Recheck migration IDs before accepting any new migration.
5. Run `git status --short`, `git diff --check`, and search for conflict markers.
6. Regenerate the lockfile only when dependency inputs changed; a clean lockfile does not prove the
   source merge is complete.
7. Run the focused verification matrix below.
8. Append a sync-log entry including conflicts, decisions, tests, and remaining updates.
9. Commit normally and push without force:

```sh
git push fork nightly/main-plus-experimental
git ls-remote fork refs/heads/nightly/main-plus-experimental
```

If PR #2829 is eventually merged to `main`, merge `main` first and inspect ancestry. A squash merge
may require a one-time duplicate/conflict cleanup; do not rewrite the published integration history.

## Verification matrix

| Area | Required focused evidence |
| --- | --- |
| Merge integrity | no unmerged paths, no conflict markers, `git diff --check` clean |
| Contracts | focused orchestration V2, goal, scheduled-task, and RPC schema tests |
| Server V2 | provider adapter, run execution, projection, settlement, migration, and scheduler tests |
| Client runtime | V2 projection, shell, commands, queue, settlement, and scheduled-task state tests |
| Web | focused composer, goal, scheduled-task, sidebar, and ChatView tests plus scoped type/lint checks |
| Mobile | focused V2 thread presentation and command-menu tests when shared behavior changes |
| Integrated web | isolated `test-t3-app` pass covering commands, goal UI, schedule CRUD/persistence, run-now, and thread creation |
| Build | `vp run build:desktop` and `node scripts/release-smoke.ts` after focused checks |

Repository policy prohibits routine local full-suite runs. Use focused tests and affected-package
type/lint checks; leave the complete suite to CI unless a specific integration failure requires more.

## Personal nightly build contract

The first publication establishes a buildable branch, not a production release channel.

- Do not reuse the upstream scheduled release workflow unchanged: it can publish npm packages,
  GitHub releases, Vercel aliases, and production relay configuration.
- Do not publish to the upstream `nightly` npm dist-tag from this branch.
- The minimum acceptable local artifact gate is the desktop build plus release smoke check.
- A future personal GitHub Actions workflow must be build-only at first, use a distinct artifact name
  such as `keeperxy-nightly.<date>.<run>`, and avoid production environments and secrets.
- GitHub `schedule` workflows execute from a repository's default branch. A scheduled personal build
  therefore requires an explicit fork-level workflow/default-branch decision; it is not silently
  enabled by this integration branch.

## Local Web launcher

Use the checked-in wrapper to start the server and Web UI together:

```sh
./scripts/start-nightly-web.sh
```

The default state directory is `.t3/nightly-main-plus-experimental`, so restarts reuse pairing,
projects, threads, goals, and schedules without touching the normal user-level T3 state. The wrapper
uses the repository-local Vite+ binary through Corepack, auto-bootstraps this checkout as a project,
and prints the complete first-start pairing URL.

Useful variants:

```sh
# Open the system browser automatically.
./scripts/start-nightly-web.sh --open-browser

# Override the automatically detected address when needed.
./scripts/start-nightly-web.sh --network-host 192.168.1.20
```

The wrapper binds to `0.0.0.0` by default, prefers the machine's Tailscale IPv4 address when available,
falls back to the primary LAN address, and configures the browser to use network-reachable Web, HTTP
API, and WebSocket URLs. Use the actual LAN or Tailnet address for `--network-host` when auto-detection
selects the wrong interface. Advanced overrides are available through `--web-url`, `--api-url`, and
`--port`; other arguments such as `--dry-run` are forwarded to `scripts/dev-runner.ts`.

## Sync log

### 2026-07-23 - Initial integration

- Baseline: `origin/main@2d31cb022dee43e5a729273a6936228f30077e29`
- Feature head: PR #2829 at `f30673fea7df138fc210fbab4288fb03aaa96142`
- Closed reference: PR #3558 at `21bf9696b29117c90e18f05bd8043c8fed5d9c9c`
- Scheduler source: PR #3638 / feature-base merge `dac514e6b6237c07e9ab3c5415e97472a96926b2`
- Conflicts: mobile, deleted V1 server seams, V1 snapshot compatibility, migrations, web
  ChatView/Sidebar/composer, and client-runtime V1-to-V2 state.
- Key decisions: full V2 retained because scheduled tasks depend on it; migration IDs shifted to
  34-41; current `main` settlement was ported to V2; slash commands and goals are being
  reimplemented rather than cherry-picked.
- Baseline merge commit: `c056279e2d1f7584ef1fe91d124a67d61f7cb2fe`.
- Verification completed for this merge:
  - contracts, client-runtime, server, web, and mobile affected-package typechecks
  - repo lint with `--deny-warnings`
  - 20 ACP process-tree tests, 54 ACP/XAi/MCP tests, 195 V2 settlement tests, 169 server lifecycle
    tests, 204 mobile V2/settlement tests, 104 web settlement/sidebar tests, and 8 scheduled-task UI
    tests
  - clean conflict-marker and diff checks
- Initial publication head: `db0cd8532`; the final documentation update was pushed immediately
  afterward and the remote ref was verified against local `HEAD`.

### 2026-07-23 - Refresh to current main

- Previous baseline: `origin/main@2d31cb022dee43e5a729273a6936228f30077e29`
- New baseline: `origin/main@b44ed835c63caafae619e303ca019a251c2698b2`
- Merge commit: `67541df53`
- Conflicts: ten Web files in ChatView/composer, Sidebar V2, timeline, diff/provider/popover surfaces,
  and CSS after the upstream glass-surface redesign.
- Decisions: retain V2 run, subagent, queue, settlement, and environment behavior while adopting the
  current `main` glass layout, opacity settings, banner behavior, and dark-mode surfaces.
- Verification: Web typecheck, 143 focused Web tests across ChatView/composer, Sidebar, timeline, and
  provider settings, plus targeted formatting, lint with `--deny-warnings`, marker checks, and diff
  checks.

### 2026-07-23 - Slash commands, native goals, and first-publication verification

- Feature commits:
  - `8919694ea`: `/review`, `/compact`, goal contracts, migration, and durable projection
  - `95dafb0e0`: provider runtime support for native Codex goals
  - `617e948be`: no-run goal command service
  - `6bd14fd4c`: goal RPC and client runtime
  - `4e03d417b`: Web `/goal` UX and persistent goal display
- Focused tests:

  ```sh
  corepack pnpm exec vp test run \
    packages/contracts/src/orchestrationV2.test.ts \
    packages/contracts/src/rpc.test.ts \
    packages/client-runtime/src/operations/commands.test.ts \
    packages/client-runtime/src/state/orchestrationV2Projection.test.ts \
    apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts \
    apps/server/src/orchestration-v2/ProjectionStore.test.ts \
    apps/server/src/orchestration-v2/ProviderEventIngestor.test.ts \
    apps/server/src/orchestration-v2/ProviderSessionManager.test.ts \
    apps/server/src/orchestration-v2/RunExecutionService.test.ts \
    apps/server/src/orchestration-v2/ThreadGoalService.test.ts \
    apps/server/src/persistence/Migrations/041_OrchestrationV2ThreadGoals.test.ts \
    apps/server/src/scheduledTasks/Schedule.test.ts \
    apps/web/src/components/chat/threadGoalLogic.test.ts \
    apps/web/src/components/chat/ThreadGoalControls.test.tsx \
    apps/web/src/components/settings/ScheduledTasksSettings.logic.test.ts \
    apps/web/src/components/settings/ScheduledTasksSettings.test.tsx
  ```

  Result: 16 files and 142 tests passed.
- Affected-package typechecks passed for Contracts, Client Runtime, Server, Web, and Mobile.
- `corepack pnpm exec vp lint --deny-warnings`, `corepack pnpm exec vp fmt --check`, and
  `git diff --check` passed.
- Integrated Web verification used a disposable base directory and a controlled headless Chromium
  session because the connected preview tab could not reach the environment port. Verified:
  - a real Codex thread exposes `/goal`, `/review`, and `/compact` in the slash-command menu
  - `/goal <objective>` sets a native goal and the header/details UI persists after page reload
  - GUI budget editing plus pause/resume and confirmed clear work
  - SQLite message/run counts remain unchanged by goal operations
  - a project-scoped interval task persists across reload, pauses/resumes, runs immediately into a
    new Codex thread, reports a successful dispatch, and requires confirmation before deletion
- `corepack pnpm exec vp run build:desktop` passed. The build retained existing chunk-size and
  generated-declaration sourcemap warnings.
- Release smoke passed with:

  ```sh
  PATH="$PWD/node_modules/.bin:$PATH" node scripts/release-smoke.ts
  ```

  The explicit path is required in shells where `vp` is not installed globally because the smoke
  script spawns `vp` directly.
- Final upstream refresh: `origin/main` remained
  `b44ed835c63caafae619e303ca019a251c2698b2`; no additional merge was required.
- Publication: created `fork/nightly/main-plus-experimental` without force-push, set it as the local
  upstream, and verified the final remote ref against local `HEAD`.

### 2026-07-23 - Local Web launcher

- Added `scripts/start-nightly-web.sh` and the `nightly:web` package command.
- Defaults to all-interface binding, prefers an available Tailscale IPv4 address before falling back to
  the primary LAN address, and keeps persistent branch-local state under
  `.t3/nightly-main-plus-experimental`.
- Supports automatic browser opening, remote binding with an explicit public pairing URL, custom
  state directories, and forwarding of dev-runner options.
- The dev runner now accepts `--api-url` so remote browsers use network-reachable HTTP and WebSocket
  endpoints instead of their own `localhost`.
- Network-hosted development clients route cookie-authenticated HTTP requests through the Web origin's
  Vite proxy while keeping WebSocket traffic on the API port. Wildcard binding also lets the HMR client
  derive the actual browser host instead of attempting to connect to `0.0.0.0`.
- Update watchlist: keep wrapper flags aligned with `scripts/dev-runner.ts`, verify network-address
  detection on the target host, and retain the repository-local `corepack pnpm exec vp` invocation so
  no global `vp` install is required.

### 2026-07-24 - Current main and PR #2829 refresh

- Previous baseline: `origin/main@b44ed835c63caafae619e303ca019a251c2698b2`.
- New baseline: `origin/main@bb38c3320d0a4eec4e9097fdc400970d881ff559`, integrated by
  merge commit `631809152`.
- Refreshed PR #2829 from `f30673fea7df138fc210fbab4288fb03aaa96142` to
  `7732874f501e48f74b19866c95a086af7b1ee6ad`, integrated by merge commit `4fc842fc0`.
- Post-merge compatibility fixes are in `38f1cdc26e82fc1752270426ca7fc6c9f95d2776`.
- Conflicts covered the current ChatView route and header contracts, command menu and Sidebar V2
  projections, timeline and toolbar components, mobile/server contracts, styles, migrations, and
  replay fixtures.
- Decisions:
  - retain the V2 orchestrator, scheduler, native goal support, queueing, and settlement semantics
  - adopt current-main auto runtime selection, `t3.json` scripts, direct settled-thread URLs,
    large-diff collapsing, current UI/mobile behavior, and Claude skill handling
  - keep queued runs non-blocking when starting the next queue entry while still preventing thread
    settlement until the queue is empty
  - preserve migration IDs 1 through 42; the renamed `041_ProjectionThreadsSettled.ts` file remains
    registry migration 33
  - allow plan-only commits to pass the formatter hook when every staged path is intentionally
    excluded by the formatter
- Focused verification:
  - 36 integration test files and 633 tests passed
  - 4 replay suites passed with 79 passing and 1 skipped test
  - Contracts, Client Runtime, Server, Web, and Mobile typechecks passed
  - scoped lint with `--deny-warnings`, marker scans, and `git diff --check` passed
  - desktop build and release smoke passed
- Integrated Web verification used an isolated environment and repository-pinned Chromium after the
  collaborative preview repeatedly failed to attach to the environment port. A real Codex thread
  exposed `/goal`, `/review`, and `/compact`; goal create/display, pause/resume, budget edit, clear,
  and reload persistence worked without creating a run. Schedule create/reload, pause/resume,
  run-now, new-thread dispatch, successful agent response, confirmed delete, and empty-state
  persistence also worked.
- Lyra macOS build:
  - source: `38f1cdc26e82fc1752270426ca7fc6c9f95d2776`
  - artifact:
    `~/codex-t3code-nightly/artifacts/mac-38f1cdc26/T3-Code-0.0.28-arm64.dmg`
  - SHA-256: `72922da20a18ddaddc835ff9517b7d7d6f872f59137df9c6c0dcb8978f292399`
  - DMG validation, arm64 bundle inspection, ad-hoc signature verification, and application launch
    passed
- Lyra iOS Simulator build:
  - source: `38f1cdc26e82fc1752270426ca7fc6c9f95d2776`
  - artifact:
    `~/codex-t3code-nightly/artifacts/ios-38f1cdc26/T3CodeDev-simulator.zip`
  - SHA-256: `47b3c154f32465bbfcfef477011cd2b2675a379d8d379022da5230c9788b5240`
  - `com.t3tools.t3code.dev` built for arm64, installed, and launched on the iPhone 17 Pro simulator;
    the captured Dev Client screen correctly reported no running development server
- Apple distribution caveat: the macOS artifact is ad-hoc signed and not notarized. A physical-device
  iOS or TestFlight build still requires an Apple Developer team, signing certificate, and
  provisioning profile.
- Known client gap: native `/goal` controls are Web-only. Mobile exposes `/review` and `/compact`,
  but needs a dedicated goal UI before `/goal` can be used safely there.

## Completion and retirement rules

The initial task can be marked `DONE` only when:

- the merge and all required compatibility ports are committed
- all ledger entries requested for the first nightly are `DONE` or have an explicit non-blocking
  limitation accepted above
- focused verification and the integrated web pass are recorded
- the branch is pushed to `fork/nightly/main-plus-experimental`
- the remote SHA is verified

Do not delete a ledger entry when upstream catches up. Mark it `ADOPTED_UPSTREAM`, record the main
commit that replaced it, and keep the retirement decision in the sync log.
