import { app } from 'electron'
import { join } from 'path'
import { createEngine, type Engine } from './engine/engine'
import { createRealPersistenceAdapter } from './engine/real-persistence-adapter'
import { createRealProcessAdapter } from './engine/real-process-adapter'

export function createProductionEngine(): Engine {
  const stateFilePath = join(app.getPath('userData'), 'orca-state.json')
  const persistence = createRealPersistenceAdapter(stateFilePath)

  const processAdapter = createRealProcessAdapter()

  return createEngine({ persistence, process: processAdapter })
}
