export function PromptText({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  return <pre className={`font-mono whitespace-pre-wrap [word-break:break-word] ${className}`}>{text}</pre>
}
