import { describe, expect, it } from 'vitest'
import { createMockOrca } from './mock-orca'
import { needsAttentionSessions } from '../view-models/session'
import type { MockSession } from './placeholder-types'

describe('createMockOrca fixtures', () => {
  it('mirrors the mockups: 3 projects and 7 sessions', async () => {
    const { api } = createMockOrca()
    const [projects, sessions] = await Promise.all([api.listProjects(), api.listSessions()])
    expect(projects).toHaveLength(3)
    expect(sessions).toHaveLength(7)
  })

  it('every session belongs to a real project', async () => {
    const { api } = createMockOrca()
    const projects = await api.listProjects()
    const sessions = await api.listSessions()
    const projectIds = new Set(projects.map((project) => project.id))
    for (const session of sessions) {
      expect(projectIds.has(session.projectId)).toBe(true)
    }
  })

  it('has exactly two "Needs you" sessions - one permission, one input', async () => {
    const { api } = createMockOrca()
    const attention = needsAttentionSessions(await api.listSessions())
    expect(attention).toHaveLength(2)
    const types = attention.map((session) => session.pendingPrompt?.type).sort()
    expect(types).toEqual(['input', 'permission'])
  })

  it('includes a session carrying a plan, a queued prompt, and a pending permission request', async () => {
    const { api } = createMockOrca()
    const sessions = (await api.listSessions()) as MockSession[]
    const withPlan = sessions.find(
      (session) =>
        (session.plan?.length ?? 0) > 0 &&
        (session.queuedPrompts?.length ?? 0) > 0 &&
        session.pendingPrompt?.type === 'permission'
    )
    expect(withPlan).toBeDefined()
  })

  it('resolves a diff for a session with changes and an empty diff for an idle one', async () => {
    const { api } = createMockOrca()
    const sessions = (await api.listSessions()) as MockSession[]
    const changed = sessions.find((session) => (session.fileCount ?? 0) > 0)!
    const idle = sessions.find((session) => session.status === 'idle')!
    expect((await api.getDiff(changed.id)).length).toBeGreaterThan(0)
    expect(await api.getDiff(idle.id)).toEqual([])
  })

  it('resolves a transcript of contract-shaped messages for a session', async () => {
    const { api } = createMockOrca()
    const sessions = await api.listSessions()
    const transcript = await api.getTranscript(sessions[0].id)
    expect(Array.isArray(transcript)).toBe(true)
    for (const message of transcript) {
      expect(message.role === 'user' || message.role === 'assistant').toBe(true)
      expect(typeof message.text).toBe('string')
    }
  })
})

describe('createMockOrca controls', () => {
  it('empties Home when toggled and restores it when toggled back', async () => {
    const { api, controls } = createMockOrca()
    expect(controls.isHomeEmpty()).toBe(false)

    controls.setHomeEmpty(true)
    expect(controls.isHomeEmpty()).toBe(true)
    expect(await api.listProjects()).toEqual([])
    expect(await api.listSessions()).toEqual([])

    controls.setHomeEmpty(false)
    expect((await api.listProjects()).length).toBe(3)
    expect((await api.listSessions()).length).toBe(7)
  })
})

describe('createMockOrca mutations keep the clickthrough consistent', () => {
  it('stopSession moves a running session to stopped', async () => {
    const { api } = createMockOrca()
    const running = (await api.listSessions()).find((session) => session.status === 'running')!
    const stopped = await api.stopSession(running.id)
    expect(stopped.status).toBe('stopped')
    const after = (await api.listSessions()).find((session) => session.id === running.id)!
    expect(after.status).toBe('stopped')
  })

  it('spawnSession adds a bare idle session to the project', async () => {
    const { api } = createMockOrca()
    const projects = await api.listProjects()
    const before = await api.listSessions()
    const spawned = await api.spawnSession(projects[0].id)
    expect(spawned.status).toBe('idle')
    expect(spawned.projectId).toBe(projects[0].id)
    expect(spawned.pendingPrompt).toBeUndefined()
    const after = await api.listSessions()
    expect(after).toHaveLength(before.length + 1)
    expect(after.some((session) => session.id === spawned.id)).toBe(true)
  })

  it('respondToPrompt clears a pending permission prompt', async () => {
    const { api } = createMockOrca()
    const waiting = (await api.listSessions()).find(
      (session) => session.pendingPrompt?.type === 'permission'
    )!
    const answered = await api.respondToPrompt(waiting.id, 'approve')
    expect(answered.pendingPrompt).toBeUndefined()
  })

  it('adoptSession adds a session for an untracked pid', async () => {
    const { api } = createMockOrca()
    const before = await api.listSessions()
    const adopted = await api.adoptSession(7777, '/work/adopted')
    expect(adopted.pid).toBe(7777)
    expect(adopted.worktreePath).toBe('/work/adopted')
    const after = await api.listSessions()
    expect(after).toHaveLength(before.length + 1)
  })

  it('adoptSession rejects a pid that is already tracked and active', async () => {
    const { api } = createMockOrca()
    const active = (await api.listSessions()).find((session) => session.status === 'running')!
    await expect(api.adoptSession(active.pid, '/work/adopted')).rejects.toThrow(/already tracked/)
  })

  it('rejects operations on an unknown session', async () => {
    const { api } = createMockOrca()
    await expect(api.getDiff('does-not-exist')).rejects.toThrow()
  })
})
