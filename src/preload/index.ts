import { contextBridge } from 'electron'

const orca = {}

contextBridge.exposeInMainWorld('orca', orca)
