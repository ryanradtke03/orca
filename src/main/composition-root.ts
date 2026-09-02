import { app } from 'electron'
import { join } from 'path'
import { createEngine, type Engine } from './engine/engine'
import { createRealGitAdapter } from './engine/real-git-adapter'
import { createRealNotificationAdapter } from './engine/real-notification-adapter'
import { createRealPersistenceAdapter } from './engine/real-persistence-adapter'
import { createRealProcessAdapter } from './engine/real-process-adapter'

export function createProductionEngine(): Engine {
  const stateFilePath = join(app.getPath('userData'), 'orca-state.json')
  const persistence = createRealPersistenceAdapter(stateFilePath)

  const worktreesRootDir = join(app.getPath('userData'), 'worktrees')
  const git = createRealGitAdapter(worktreesRootDir)

  const sessionLogsDir = join(app.getPath('userData'), 'session-logs')
  const claudeProcess = createRealProcessAdapter('claude', [], sessionLogsDir)
  const notification = createRealNotificationAdapter()

  return createEngine({ persistence, git, process: claudeProcess, notification })
}
