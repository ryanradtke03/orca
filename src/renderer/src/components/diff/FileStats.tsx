import type { FileDiff } from '../../../../shared/ipc-contract'

export function FileStats({ file }: { file: FileDiff }): React.JSX.Element {
  return (
    <>
      <span className="text-diff-add">+{file.additions}</span> <span className="text-diff-del">−{file.deletions}</span>
    </>
  )
}

export function FileStatusBadge({ file }: { file: FileDiff }): React.JSX.Element {
  return (
    <span className="rounded border border-border-medium px-[7px] py-[3px] text-[9px] leading-none font-medium tracking-[0.09em] text-secondary uppercase">
      {file.status}
    </span>
  )
}
