import type { GitHubAdapter, PullRequestStatus } from './adapters'

export interface FakeGitHubAdapter extends GitHubAdapter {
  openPullRequestCalls: { projectPath: string; branch: string; title: string }[]
  getPullRequestStatusCalls: string[]
  simulateMerged(url: string): void
  simulateClosed(url: string): void
}

export function createFakeGitHubAdapter(): FakeGitHubAdapter {
  let counter = 0
  const openPullRequestCalls: { projectPath: string; branch: string; title: string }[] = []
  const getPullRequestStatusCalls: string[] = []
  const statusByUrl = new Map<string, PullRequestStatus>()

  return {
    openPullRequestCalls,
    getPullRequestStatusCalls,

    async openPullRequest(params) {
      counter += 1
      const url = `https://github.com/fake/fake/pull/${counter}`
      openPullRequestCalls.push(params)
      statusByUrl.set(url, 'open')
      return { url }
    },

    async getPullRequestStatus(url: string) {
      getPullRequestStatusCalls.push(url)
      return statusByUrl.get(url) ?? 'open'
    },

    simulateMerged(url: string): void {
      statusByUrl.set(url, 'merged')
    },

    simulateClosed(url: string): void {
      statusByUrl.set(url, 'closed')
    }
  }
}
