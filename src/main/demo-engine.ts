import type { FileDiff } from '../shared/ipc-contract'
import { createEngine, type Engine } from './engine/engine'
import { createFakeDiscoveryAdapter } from './engine/fake-discovery-adapter'
import { createFakeGitAdapter, type FakeGitAdapter } from './engine/fake-git-adapter'
import { createFakeGitHubAdapter, type FakeGitHubAdapter } from './engine/fake-github-adapter'
import { createFakeNotificationAdapter } from './engine/fake-notification-adapter'
import { createFakePersistenceAdapter } from './engine/fake-persistence-adapter'
import { createFakeProcessAdapter, type FakeProcessAdapter } from './engine/fake-process-adapter'

const DEMO_PROJECT_ID = 'demo-project'
const LOCAL_MERGE_PROJECT_ID = 'demo-project-local-merge'
const PULL_REQUEST_PROJECT_ID = 'demo-project-pull-request'

// Path/pid for the #9 "discovered" session - never created via spawnSession,
// so its Project only exists because discoverSessions() creates one on the
// fly for a path it doesn't recognize. Kept 'running' (and registered alive
// on the fake Process adapter below) rather than a terminal status: since
// 'running' is in ACTIVE_STATUSES, discoverSessions() treats it as already
// tracked on every later scan and never re-adds a duplicate - a terminal
// status would need an extra mechanism to stop scan() reporting it once
// discovered, racing whenever that actually happens.
const DISCOVERED_PROJECT_PATH = '/demo/orca-scratch'
const DISCOVERED_PID = 9999

const SMALL_DIFF: FileDiff[] = [
  {
    path: 'src/index.ts',
    status: 'modified',
    additions: 2,
    deletions: 0,
    diffText: [
      'diff --git a/src/index.ts b/src/index.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,2 +1,4 @@',
      ' export function main() {',
      "+  console.log('starting up')",
      "+  console.log('ready')",
      ' }'
    ].join('\n')
  }
]

const RICH_DIFF: FileDiff[] = [
  {
    path: 'src/shared/ipc-contract.ts',
    status: 'modified',
    additions: 4,
    deletions: 1,
    diffText: [
      'diff --git a/src/shared/ipc-contract.ts b/src/shared/ipc-contract.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/shared/ipc-contract.ts',
      '+++ b/src/shared/ipc-contract.ts',
      '@@ -12,6 +12,9 @@ export interface Project',
      ' export type SessionStatus =',
      "   | 'running'",
      "-  | 'waiting'",
      "+  | 'waiting-on-permission'",
      "+  | 'waiting-on-input'",
      "   | 'idle'"
    ].join('\n')
  },
  {
    path: 'src/main/engine/git-diff-parser.ts',
    status: 'added',
    additions: 3,
    deletions: 0,
    diffText: [
      'diff --git a/src/main/engine/git-diff-parser.ts b/src/main/engine/git-diff-parser.ts',
      'new file mode 100644',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/src/main/engine/git-diff-parser.ts',
      '@@ -0,0 +1,3 @@',
      '+export function parseUnifiedDiff(raw: string) {',
      '+  return []',
      '+}'
    ].join('\n')
  },
  {
    path: 'src/renderer/src/legacy.ts',
    status: 'deleted',
    additions: 0,
    deletions: 3,
    diffText: [
      'diff --git a/src/renderer/src/legacy.ts b/src/renderer/src/legacy.ts',
      'deleted file mode 100644',
      'index 1234567..0000000',
      '--- a/src/renderer/src/legacy.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-const app = document.querySelector("#app")',
      '-render()',
      '-'
    ].join('\n')
  }
]

const DEMO_PERMISSION_PROMPT_TEXT = [
  'Bash command',
  '',
  '  rm -rf out/',
  '',
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. No, and tell Claude what to do differently (esc)'
].join('\n')

async function seedDemoData(
  engine: Engine,
  git: FakeGitAdapter,
  processAdapter: FakeProcessAdapter,
  github: FakeGitHubAdapter
): Promise<void> {
  const running = await engine.spawnSession(DEMO_PROJECT_ID)
  git.simulateDiff(running.worktreePath, SMALL_DIFF)

  const waiting = await engine.spawnSession(DEMO_PROJECT_ID)
  git.simulateDiff(waiting.worktreePath, SMALL_DIFF)
  processAdapter.simulatePrompt(waiting.pid, { type: 'permission', text: DEMO_PERMISSION_PROMPT_TEXT })

  const finished = await engine.spawnSession(DEMO_PROJECT_ID)
  git.simulateDiff(finished.worktreePath, RICH_DIFF)
  processAdapter.simulateExit(finished.pid, 0)

  // Local merge (#33): "Request merge" reclaims the worktree the moment the
  // branch is integrated - nothing left in it is worth reviewing.
  const readyToMerge = await engine.spawnSession(LOCAL_MERGE_PROJECT_ID)
  git.simulateDiff(readyToMerge.worktreePath, SMALL_DIFF)
  processAdapter.simulateExit(readyToMerge.pid, 0)

  // Pull request (#33): "Request merge" opens a PR and leaves the worktree in
  // place, since opening a PR doesn't integrate the branch.
  const awaitingReview = await engine.spawnSession(PULL_REQUEST_PROJECT_ID)
  git.simulateDiff(awaitingReview.worktreePath, RICH_DIFF)
  processAdapter.simulateExit(awaitingReview.pid, 0)

  // A second Pull request Session whose PR is opened up front and already
  // shows merged on GitHub's side, so the app's own status-poll loop
  // reclaims its worktree live, the same way it would once a real PR lands.
  const alreadyApproved = await engine.spawnSession(PULL_REQUEST_PROJECT_ID)
  git.simulateDiff(alreadyApproved.worktreePath, SMALL_DIFF)
  processAdapter.simulateExit(alreadyApproved.pid, 0)

  await engine.refreshSessionStatuses()

  const { pullRequestUrl } = await engine.requestMerge(alreadyApproved.id)
  if (pullRequestUrl) github.simulateMerged(pullRequestUrl)
}

/**
 * Runs the real app against the same fake adapters engine.test.ts uses,
 * seeded with a project and a few sessions in different states (running,
 * waiting-on-permission, done) each with a canned diff already attached -
 * so the UI can be clicked through end-to-end without a real `claude`
 * process or git repo. Opt in via `ORCA_DEMO=1` (see index.ts).
 */
export function createDemoEngine(): Engine {
  const persistence = createFakePersistenceAdapter({
    projects: [
      { id: DEMO_PROJECT_ID, path: '/demo/orca', name: 'orca (demo)', mergeMode: 'manual' },
      {
        id: LOCAL_MERGE_PROJECT_ID,
        path: '/demo/orca-docs',
        name: 'orca-docs (demo)',
        mergeMode: 'local-merge'
      },
      {
        id: PULL_REQUEST_PROJECT_ID,
        path: '/demo/orca-api',
        name: 'orca-api (demo)',
        mergeMode: 'pull-request'
      }
    ]
  })
  const git = createFakeGitAdapter()
  const processAdapter = createFakeProcessAdapter()
  const notification = createFakeNotificationAdapter()
  const github = createFakeGitHubAdapter()
  // Seeded (rather than added via seedDemoData below) so it's already
  // present for index.ts's launch-time discoverSessions() call, which races
  // the rest of this function's async setup.
  const discovery = createFakeDiscoveryAdapter({
    sessions: [
      {
        pid: DISCOVERED_PID,
        cwd: DISCOVERED_PROJECT_PATH,
        projectPath: DISCOVERED_PROJECT_PATH,
        branch: 'scratch/quick-fix',
        baseRef: 'base-scratch',
        status: 'running'
      }
    ]
  })
  processAdapter.registerAlive(DISCOVERED_PID)
  git.simulateDiff(DISCOVERED_PROJECT_PATH, SMALL_DIFF)

  const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
  void seedDemoData(engine, git, processAdapter, github).catch((error) => {
    console.error('Failed to seed demo data:', error)
  })

  return engine
}
