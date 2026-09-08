import type { FileDiff, Project } from '../../../shared/ipc-contract'
import type { MockFileDiff, MockSession, MockTranscriptEntry } from './placeholder-types'

/**
 * Fixture data mirroring the approved mockups (docs/mockups/) so the renderer
 * can be built and clicked through without a working engine (ticket #49):
 * 3 projects, 7 sessions, 2 "Needs you" items, and session-4f2a carrying a
 * plan, a queued prompt, and a pending permission request.
 *
 * Sessions are described richer than the shared contract (via MockSession /
 * MockTranscriptEntry); the mock backend narrows them back to contract shapes
 * when it answers listSessions/getDiff/getTranscript. Extra fields ride along
 * for the expanded screens the four follow-up tickets build.
 */

export const MOCK_PROJECTS: Project[] = [
  { id: 'proj-orca', path: '~/code/orca', name: 'orca', mergeMode: 'pull-request' },
  { id: 'proj-atlas-api', path: '~/work/atlas-api', name: 'atlas-api', mergeMode: 'local-merge' },
  { id: 'proj-marketing-site', path: '~/sites/marketing-site', name: 'marketing-site', mergeMode: 'manual' }
]

export const BASE_REF = '8c41d2f'

export interface MockSessionFixture {
  session: MockSession
  diff: MockFileDiff[]
  transcript: MockTranscriptEntry[]
}

// --- Diffs -----------------------------------------------------------------

const IPC_CONTRACT_DIFF: MockFileDiff = {
  path: 'src/shared/ipc-contract.ts',
  status: 'modified',
  additions: 64,
  deletions: 9,
  reviewed: false,
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
    "   | 'idle'",
    "+  | 'stopped'"
  ].join('\n')
}

const MAIN_INDEX_DIFF: MockFileDiff = {
  path: 'src/renderer/src/main.tsx',
  status: 'modified',
  additions: 11,
  deletions: 2,
  reviewed: true,
  diffText: [
    'diff --git a/src/renderer/src/main.tsx b/src/renderer/src/main.tsx',
    'index 1234567..89abcde 100644',
    '--- a/src/renderer/src/main.tsx',
    '+++ b/src/renderer/src/main.tsx',
    '@@ -1,4 +1,6 @@',
    " import { createRoot } from 'react-dom/client'",
    "+import { installMockOrca, isMockMode } from './mock'",
    ' ',
    '+if (isMockMode()) installMockOrca()'
  ].join('\n')
}

const ENGINE_DIFF: MockFileDiff = {
  path: 'src/main/engine/engine.ts',
  status: 'modified',
  additions: 188,
  deletions: 3,
  reviewed: true,
  diffText: [
    'diff --git a/src/main/engine/engine.ts b/src/main/engine/engine.ts',
    'index 1234567..89abcde 100644',
    '--- a/src/main/engine/engine.ts',
    '+++ b/src/main/engine/engine.ts',
    '@@ -40,3 +40,8 @@ export function createEngine',
    '   async stopSession(id: string) {',
    '+    const session = requireSession(id)',
    "+    session.status = 'stopped'",
    '+    return session',
    '   }'
  ].join('\n')
}

const SMALL_DIFF: FileDiff[] = [
  {
    path: 'src/index.ts',
    status: 'modified',
    additions: 38,
    deletions: 4,
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

const ONE_FILE_DIFF: FileDiff[] = [
  {
    path: 'src/routes/health.ts',
    status: 'added',
    additions: 9,
    deletions: 0,
    diffText: [
      'diff --git a/src/routes/health.ts b/src/routes/health.ts',
      'new file mode 100644',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/src/routes/health.ts',
      '@@ -0,0 +1,3 @@',
      "+export function health() {",
      "+  return { ok: true }",
      '+}'
    ].join('\n')
  }
]

const ERRORED_DIFF: FileDiff[] = [
  {
    path: 'src/db/pool.ts',
    status: 'modified',
    additions: 2,
    deletions: 2,
    diffText: [
      'diff --git a/src/db/pool.ts b/src/db/pool.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/db/pool.ts',
      '+++ b/src/db/pool.ts',
      '@@ -3,2 +3,2 @@',
      '-const MAX = 10',
      '+const MAX = 20'
    ].join('\n')
  }
]

// A mix of reviewed / not-yet-reviewed files, mirroring the diff mockup's
// per-file review progress (04a-diff-viewer-file-tree).
const HERO_DIFF: MockFileDiff[] = [IPC_CONTRACT_DIFF, MAIN_INDEX_DIFF, ENGINE_DIFF]

/** Builds a MockFileDiff from a path and its hunk lines, prepending git's own file header. */
function treeFile(
  path: string,
  status: MockFileDiff['status'],
  additions: number,
  deletions: number,
  reviewed: boolean,
  hunks: string[]
): MockFileDiff {
  return {
    path,
    status,
    additions,
    deletions,
    reviewed,
    diffText: [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunks].join('\n')
  }
}

// The multi-folder diff the diff viewer (04a) is built around: a grouped file
// tree (src/shared, src/main, src/main/engine, src/preload, src/renderer/src,
// docs/adr), per-file line counts, and three files already reviewed.
const DIFF_TREE: MockFileDiff[] = [
  treeFile('src/shared/ipc-contract.ts', 'modified', 64, 9, false, [
    '@@ -12,6 +12,10 @@ export interface Project',
    ' export type SessionStatus =',
    "   | 'running'",
    "-  | 'waiting'",
    "+  | 'waiting-on-permission'",
    "+  | 'waiting-on-input'",
    "   | 'idle'",
    "+  | 'stopped'",
    ' ',
    ' export interface Session {',
    '@@ -30,4 +34,7 @@ export const IPC_CHANNELS',
    ' export const IPC_CHANNELS = {',
    "   ping: 'engine:ping',",
    "+  spawnSession: 'session:spawn',",
    "+  stopSession: 'session:stop'",
    ' } as const'
  ]),
  treeFile('src/main/ipc.ts', 'modified', 51, 4, false, [
    '@@ -1,4 +1,6 @@',
    " import { ipcMain } from 'electron'",
    "+import { IPC_CHANNELS } from '../shared/ipc-contract'",
    ' ',
    '+export function registerIpc() {}'
  ]),
  treeFile('src/main/composition-root.ts', 'modified', 17, 2, false, [
    '@@ -8,3 +8,5 @@ export function createApp',
    '   const engine = createEngine()',
    '+  const ipc = registerIpc()',
    '+  return { engine, ipc }',
    ' }'
  ]),
  treeFile('src/main/engine/engine.ts', 'modified', 188, 3, true, [
    '@@ -40,3 +40,8 @@ export function createEngine',
    '   async stopSession(id: string) {',
    '+    const session = requireSession(id)',
    "+    session.status = 'stopped'",
    '+    return session',
    '   }'
  ]),
  treeFile('src/main/engine/worktree.ts', 'added', 42, 0, true, [
    '@@ -0,0 +1,4 @@',
    '+export async function createWorktree(branch: string) {',
    '+  await git(`worktree add ${branch}`)',
    '+  return branch',
    '+}'
  ]),
  treeFile('src/preload/index.ts', 'modified', 22, 1, false, [
    '@@ -1,3 +1,5 @@',
    " import { contextBridge } from 'electron'",
    "+import { orcaApi } from './orca-api'",
    ' ',
    "+contextBridge.exposeInMainWorld('orca', orcaApi)"
  ]),
  treeFile('src/renderer/src/main.ts', 'modified', 6, 301, true, [
    '@@ -1,6 +1,2 @@',
    "-import { renderDashboard } from './legacy/dashboard'",
    "-import { renderDiff } from './legacy/diff'",
    "-renderDashboard()",
    "+import { mount } from './app'",
    '+mount()'
  ]),
  treeFile('src/renderer/src/orca-window.d.ts', 'added', 8, 0, false, [
    '@@ -0,0 +1,3 @@',
    '+interface Window {',
    '+  orca: OrcaApi',
    '+}'
  ]),
  treeFile('docs/adr/0004-session-status.md', 'added', 31, 0, false, [
    '@@ -0,0 +1,3 @@',
    '+# ADR 0004: Session status',
    '+',
    '+Adds a `stopped` state to the SessionStatus union.'
  ])
]

// --- Sessions --------------------------------------------------------------

const FIXTURES: MockSessionFixture[] = [
  {
    // The rich one: waiting on a permission prompt, with a plan, a queued
    // prompt, and live session metadata. This is the session the mockups
    // (05b-session-chat-inspector) are built around.
    session: {
      id: 'sess-4f2a',
      projectId: 'proj-orca',
      worktreePath: '~/code/orca/.orca/session-4f2a',
      branch: 'session-4f2a',
      baseRef: BASE_REF,
      pid: 4201,
      status: 'waiting-on-permission',
      pendingPrompt: {
        type: 'permission',
        text: 'Bash(rm -rf out/)\n\nDo you want to proceed?'
      },
      model: 'sonnet-4.5',
      tokensUsed: 128_000,
      tokenLimit: 200_000,
      turns: 14,
      activityLabel: '1m',
      additions: 412,
      deletions: 86,
      fileCount: 9,
      plan: [
        { text: 'Widen SessionStatus union', state: 'done' },
        { text: 'Render the stopped badge', state: 'done' },
        { text: 'Rebuild and verify', state: 'active' },
        { text: 'Update the status ADR', state: 'pending' }
      ],
      queuedPrompts: [
        { text: 'then update docs/adr/0004 with the new state', note: 'sends after approval' }
      ]
    },
    diff: HERO_DIFF,
    transcript: [
      {
        kind: 'message',
        message: {
          id: 'msg-4f2a-1',
          role: 'user',
          text: 'Add a stopped state to SessionStatus and surface it in the renderer list.',
          timestamp: 1_725_000_000_000
        }
      },
      {
        kind: 'message',
        message: {
          id: 'msg-4f2a-2',
          role: 'assistant',
          text: 'Plan set - three edits and a build. Starting with the shared contract so the renderer typechecks against it.',
          timestamp: 1_725_000_060_000
        }
      },
      { kind: 'tool-call', id: 'tc-4f2a-1', label: 'Edit(src/shared/ipc-contract.ts)', state: 'ok', additions: 3, deletions: 1 },
      { kind: 'tool-call', id: 'tc-4f2a-2', label: 'Edit(src/renderer/src/main.tsx)', state: 'ok', additions: 11, deletions: 2 },
      { kind: 'tool-call', id: 'tc-4f2a-3', label: 'Bash(npm run build)', state: 'blocked' },
      {
        kind: 'permission-card',
        id: 'perm-4f2a',
        command: 'Bash(rm -rf out/)',
        detail: 'Clearing stale build output before rerunning the vite build. Runs in the session worktree, not your checkout.',
        waitingFor: 'waiting 1m 12s'
      }
    ]
  },
  {
    session: {
      id: 'sess-a0d1',
      projectId: 'proj-orca',
      worktreePath: '~/code/orca/.orca/session-a0d1',
      branch: 'session-a0d1',
      baseRef: BASE_REF,
      pid: 4202,
      status: 'running',
      model: 'sonnet-4.5',
      tokensUsed: 42_000,
      tokenLimit: 200_000,
      turns: 6,
      activityLabel: '2m',
      additions: 38,
      deletions: 4,
      fileCount: 2
    },
    diff: SMALL_DIFF,
    transcript: [
      {
        kind: 'message',
        message: {
          id: 'msg-a0d1-1',
          role: 'user',
          text: 'Add a couple of startup log lines.',
          timestamp: 1_725_000_100_000
        }
      }
    ]
  },
  {
    session: {
      id: 'sess-77be',
      projectId: 'proj-orca',
      worktreePath: '~/code/orca/.orca/session-77be',
      branch: 'session-77be',
      baseRef: BASE_REF,
      pid: 4203,
      status: 'idle',
      model: 'sonnet-4.5',
      tokensUsed: 0,
      tokenLimit: 200_000,
      turns: 0,
      activityLabel: '31m',
      additions: 0,
      deletions: 0,
      fileCount: 0
    },
    diff: [],
    transcript: []
  },
  {
    session: {
      id: 'sess-1b45',
      projectId: 'proj-orca',
      worktreePath: '~/code/orca/.orca/session-1b45',
      branch: 'session-1b45',
      baseRef: BASE_REF,
      pid: 4204,
      status: 'done',
      model: 'sonnet-4.5',
      tokensUsed: 156_000,
      tokenLimit: 200_000,
      turns: 22,
      additions: 429,
      deletions: 320,
      fileCount: 9
    },
    diff: DIFF_TREE,
    transcript: [
      {
        kind: 'message',
        message: {
          id: 'msg-1b45-1',
          role: 'user',
          text: 'Migrate the renderer to React.',
          timestamp: 1_724_900_000_000
        }
      },
      {
        kind: 'message',
        message: {
          id: 'msg-1b45-2',
          role: 'assistant',
          text: 'Done - the renderer now boots through React and the build is green.',
          timestamp: 1_724_900_600_000
        }
      }
    ]
  },
  {
    session: {
      id: 'sess-91c7',
      projectId: 'proj-atlas-api',
      worktreePath: '~/work/atlas-api/.orca/session-91c7',
      branch: 'session-91c7',
      baseRef: BASE_REF,
      pid: 9101,
      status: 'waiting-on-input',
      pendingPrompt: {
        type: 'input',
        text: 'Which database should the health check ping - the primary or the read replica?'
      },
      model: 'sonnet-4.5',
      tokensUsed: 71_000,
      tokenLimit: 200_000,
      turns: 9,
      activityLabel: '6m',
      additions: 9,
      deletions: 0,
      fileCount: 1,
      attentionNote: 'Asked a question - waiting on your reply for 6m'
    },
    diff: ONE_FILE_DIFF,
    transcript: [
      {
        kind: 'message',
        message: {
          id: 'msg-91c7-1',
          role: 'user',
          text: 'Add a health check endpoint.',
          timestamp: 1_725_000_200_000
        }
      },
      {
        kind: 'message',
        message: {
          id: 'msg-91c7-2',
          role: 'assistant',
          text: 'Which database should the health check ping - the primary or the read replica?',
          timestamp: 1_725_000_260_000
        }
      }
    ]
  },
  {
    session: {
      id: 'sess-c3f0',
      projectId: 'proj-atlas-api',
      worktreePath: '~/work/atlas-api/.orca/session-c3f0',
      branch: 'session-c3f0',
      baseRef: BASE_REF,
      pid: 9102,
      status: 'errored',
      model: 'sonnet-4.5',
      tokensUsed: 18_000,
      tokenLimit: 200_000,
      turns: 3,
      additions: 2,
      deletions: 2,
      fileCount: 1
    },
    diff: ERRORED_DIFF,
    transcript: [
      {
        kind: 'message',
        message: {
          id: 'msg-c3f0-1',
          role: 'user',
          text: 'Bump the connection pool size.',
          timestamp: 1_725_000_300_000
        }
      }
    ]
  },
  {
    session: {
      id: 'sess-2e9f',
      projectId: 'proj-marketing-site',
      worktreePath: '~/sites/marketing-site/.orca/session-2e9f',
      branch: 'session-2e9f',
      baseRef: BASE_REF,
      pid: 2901,
      status: 'running',
      model: 'sonnet-4.5',
      tokensUsed: 33_000,
      tokenLimit: 200_000,
      turns: 4,
      additions: 54,
      deletions: 12,
      fileCount: 3
    },
    diff: SMALL_DIFF,
    transcript: [
      {
        kind: 'message',
        message: {
          id: 'msg-2e9f-1',
          role: 'user',
          text: 'Refresh the pricing page copy.',
          timestamp: 1_725_000_400_000
        }
      }
    ]
  }
]

/** A fresh deep copy of the fixtures so a mock instance can mutate its own state freely. */
export function cloneFixtures(): MockSessionFixture[] {
  return structuredClone(FIXTURES)
}
