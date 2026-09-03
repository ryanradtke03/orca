import type { GitHubAdapter } from './adapters'

export interface FakeGitHubAdapter extends GitHubAdapter {
  openPullRequestCalls: { projectPath: string; branch: string; title: string }[]
}

export function createFakeGitHubAdapter(): FakeGitHubAdapter {
  let counter = 0
  const openPullRequestCalls: { projectPath: string; branch: string; title: string }[] = []

  return {
    openPullRequestCalls,

    async openPullRequest(params) {
      counter += 1
      openPullRequestCalls.push(params)
      return { url: `https://github.com/fake/fake/pull/${counter}` }
    }
  }
}
