import { app } from 'electron'
import { join } from 'path'
import { createEngine, type Engine } from './engine/engine'
import { createRealPersistenceAdapter } from './engine/real-persistence-adapter'

export function createProductionEngine(): Engine {
  const stateFilePath = join(app.getPath('userData'), 'orca-state.json')
  const persistence = createRealPersistenceAdapter(stateFilePath)

  return createEngine({ persistence })
}
