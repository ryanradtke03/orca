import type { FileDiff } from '../shared/ipc-contract'
import { createEngine, type Engine } from './engine/engine'
import { createFakeGitAdapter, type FakeGitAdapter } from './engine/fake-git-adapter'
import { createFakeGitHubAdapter } from './engine/fake-github-adapter'
import { createFakeNotificationAdapter } from './engine/fake-notification-adapter'
import { createFakePersistenceAdapter } from './engine/fake-persistence-adapter'
import { createFakeProcessAdapter, type FakeProcessAdapter } from './engine/fake-process-adapter'

const DEMO_PROJECT_ID = 'demo-project'

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
  processAdapter: FakeProcessAdapter
): Promise<void> {
  const running = await engine.spawnSession(DEMO_PROJECT_ID)
  git.simulateDiff(running.worktreePath, SMALL_DIFF)

  const waiting = await engine.spawnSession(DEMO_PROJECT_ID)
  git.simulateDiff(waiting.worktreePath, SMALL_DIFF)
  processAdapter.simulatePrompt(waiting.pid, { type: 'permission', text: DEMO_PERMISSION_PROMPT_TEXT })

  const finished = await engine.spawnSession(DEMO_PROJECT_ID)
  git.simulateDiff(finished.worktreePath, RICH_DIFF)
  processAdapter.simulateExit(finished.pid, 0)

  await engine.refreshSessionStatuses()
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
      { id: DEMO_PROJECT_ID, path: '/demo/orca', name: 'orca (demo)', mergeMode: 'manual' }
    ]
  })
  const git = createFakeGitAdapter()
  const processAdapter = createFakeProcessAdapter()
  const notification = createFakeNotificationAdapter()
  const github = createFakeGitHubAdapter()

  const engine = createEngine({ persistence, git, process: processAdapter, notification, github })
  void seedDemoData(engine, git, processAdapter)

  return engine
}
