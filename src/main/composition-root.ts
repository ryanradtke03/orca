import { app } from 'electron'
import { join } from 'path'
import { createEngine, type Engine } from './engine/engine'
import { createRealDiscoveryAdapter } from './engine/adapters/discovery/real'
import { createRealGitAdapter } from './engine/adapters/git/real'
import { createRealGitHubAdapter } from './engine/adapters/github/real'
import { createRealNotificationAdapter } from './engine/adapters/notification/real'
import { createRealPersistenceAdapter } from './engine/adapters/persistence/real'
import { createRealProcessAdapter } from './engine/adapters/process/real'

export function createProductionEngine(): Engine {
  const stateFilePath = join(app.getPath('userData'), 'orca-state.json')
  const persistence = createRealPersistenceAdapter(stateFilePath)

  const worktreesRootDir = join(app.getPath('userData'), 'worktrees')
  const git = createRealGitAdapter(worktreesRootDir)

  const claudeProcess = createRealProcessAdapter('claude')
  const notification = createRealNotificationAdapter()
  const github = createRealGitHubAdapter()
  const discovery = createRealDiscoveryAdapter('claude')

  return createEngine({ persistence, git, process: claudeProcess, notification, github, discovery })
}
