# Nightly Main Plus Experimental Integration

Status: READY_FOR_PUBLICATION

Last updated: 2026-07-23

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
| `origin/main` | `b44ed835c63caafae619e303ca019a251c2698b2` | 2026-07-23 | Integrated by `67541df53` |
| Integration branch | `4e03d417b` | 2026-07-23 | Requested feature implementation complete |
| PR #2829 | `f30673fea7df138fc210fbab4288fb03aaa96142` | 2026-07-23 | Draft, conflicting upstream; integrated by `c056279e2` |
| PR #3558 | `21bf9696b29117c90e18f05bd8043c8fed5d9c9c` | 2026-07-23 | Closed without merge; V2-native replacement integrated |
| PR #3638 | merge commit `dac514e6b6237c07e9ab3c5415e97472a96926b2` | 2026-07-23 | Integrated through PR #2829; not present on upstream `main` |
| Issue #3164 | open | 2026-07-23 | Cron/prompt MVP integrated; external event triggers remain upstream scope |

The implementation and first-publication verification are complete. The only remaining gate is
publishing and verifying `fork/nightly/main-plus-experimental`.

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

1. Main migration 33 (`ProjectionThreadsSettled`) remains immutable. The PR #2829 migrations that
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
- Remaining first-publication gate: remote publication.

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
