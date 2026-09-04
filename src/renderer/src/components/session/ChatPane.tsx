import type { Session, SessionStatus, TranscriptMessage } from '../../../../shared/ipc-contract'
import { PromptActions } from '../PromptActions'
import { PromptText } from '../PromptText'
import { canSendMessage, describeStatus, isTerminalStatus } from '../../session-view'
import { ReplyForm } from './ReplyForm'

function describeUnavailableChatMessage(status: SessionStatus): string {
  if (isTerminalStatus(status)) return `${describeStatus(status)} — this session has ended.`
  return `${describeStatus(status)} — can't send a message while the session is busy.`
}

function Transcript({ transcript }: { transcript: TranscriptMessage[] }): React.JSX.Element {
  return (
    <div className="mb-4">
      {transcript.map((message) => (
        <div key={message.id} className="mb-4">
          <pre
            className={`m-0 rounded-md px-[13px] py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap [word-break:break-word] ${
              message.role === 'user' ? 'bg-white/6 text-primary' : 'border border-border-faint text-secondary'
            }`}
          >
            {message.text}
          </pre>
        </div>
      ))}
    </div>
  )
}

export function ChatPane({
  session,
  transcript,
  onRespond
}: {
  session: Session
  transcript: TranscriptMessage[]
  onRespond: (response: string) => Promise<void>
}): React.JSX.Element {
  const prompt = session.pendingPrompt

  return (
    <div id="session-chat" className="flex-1 overflow-y-auto p-6">
      {transcript.length > 0 && <Transcript transcript={transcript} />}

      {prompt && (
        <div className="mb-4">
          <PromptText text={prompt.text} className="max-h-none" />
        </div>
      )}

      {prompt?.type === 'permission' ? (
        <PromptActions prompt={prompt} onRespond={onRespond} />
      ) : canSendMessage(session.status) ? (
        <>
          {transcript.length === 0 && !prompt && (
            <div className="py-10 text-[12.5px] leading-relaxed text-faint">No messages yet.</div>
          )}
          <ReplyForm onSubmit={onRespond} />
        </>
      ) : (
        <div className="py-10 text-[12.5px] leading-relaxed text-faint">
          {describeUnavailableChatMessage(session.status)}
        </div>
      )}
    </div>
  )
}
