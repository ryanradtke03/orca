import type { FileDiff, Session } from '../../../../shared/ipc-contract'
import { FileStats, FileStatusBadge } from '../diff/FileStats'
import { describeStatus } from '../../session-view'

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-[9.5px] text-faint">{label}</span>
      <span className="font-mono text-[11.5px] leading-relaxed [overflow-wrap:anywhere] text-secondary">{value}</span>
    </div>
  )
}

export function Inspector({ session, files }: { session: Session; files: FileDiff[] }): React.JSX.Element {
  return (
    <aside className="w-[280px] flex-none overflow-y-auto border-l border-border-soft bg-sidebar px-4 py-5">
      <div className="label-heading pb-2">Session info</div>
      <div className="mb-[22px] flex flex-col gap-2.5">
        <InfoRow label="Branch" value={session.branch} />
        <InfoRow label="Status" value={describeStatus(session.status)} />
        <InfoRow label="Base ref" value={session.baseRef} />
        <InfoRow
          label="Worktree"
          value={session.worktreeRemoved ? `${session.worktreePath} (removed)` : session.worktreePath}
        />
      </div>

      <div className="label-heading pb-2">Files touched</div>
      {files.length === 0 ? (
        <div className="px-0.5 py-2 text-[11px] text-faint">No changes yet</div>
      ) : (
        <div className="flex flex-col gap-px">
          {files.map((file) => (
            <div key={file.path} className="flex items-center gap-2 border-b border-border-faint px-0.5 py-[7px] last:border-b-0">
              <span className="min-w-0 flex-1 font-mono text-[10.5px] leading-tight [overflow-wrap:anywhere] text-secondary">
                {file.path}
              </span>
              <FileStatusBadge file={file} />
              <span className="flex-none font-mono text-[9.5px] whitespace-nowrap">
                <FileStats file={file} />
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
