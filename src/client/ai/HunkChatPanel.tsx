import { Sparkles, Send, X, MessageSquarePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { type HunkChatMessage } from '../../types/ai';

import { streamAsk } from './askClient';

const ACCENT = '#a371f7';

interface HunkChatPanelProps {
  filePath: string;
  side: 'old' | 'new';
  line: number;
  /** Raw hunk text (diff) to give the agent precise context. */
  hunkContent: string;
  /** Close the panel. */
  onClose: () => void;
  /** Copy an assistant answer into a real, human-authored draft comment. */
  onPromoteToComment: (body: string) => void;
}

/**
 * Per-hunk "Ask buddy" chat. The reviewer asks about the hunk; buddy answers
 * with streaming text and repo-tool access. Answers are assistive only — the
 * "Add as draft comment" button is the single bridge from an AI answer into the
 * human's own comment thread; nothing crosses automatically.
 */
export function HunkChatPanel({
  filePath,
  side,
  line,
  hunkContent,
  onClose,
  onPromoteToComment,
}: HunkChatPanelProps) {
  const [messages, setMessages] = useState<HunkChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = async () => {
    const question = input.trim();
    if (!question || streaming) return;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const withUser: HunkChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages([...withUser, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAsk(
        { filePath, side, line, question, hunkContent, history },
        (chunk) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              next[next.length - 1] = { role: 'assistant', content: last.content + chunk };
            }
            return next;
          });
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Chat failed');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div
      className="rounded-md border bg-github-bg-secondary text-sm"
      style={{ borderColor: `${ACCENT}66`, borderLeft: `3px solid ${ACCENT}` }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-github-border">
        <Sparkles size={13} style={{ color: ACCENT }} />
        <span className="text-xs font-semibold" style={{ color: ACCENT }}>
          Ask buddy about this hunk
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-github-text-muted hover:text-github-text-primary cursor-pointer"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2 flex flex-col gap-3 max-h-96 overflow-y-auto">
        {messages.length === 0 && !streaming && (
          <p className="text-xs text-github-text-muted">
            e.g. “What calls this?”, “Why was this changed?”, “What breaks if this is wrong?”
          </p>
        )}
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div key={index} className="text-github-text-primary">
              <span className="text-[10px] uppercase tracking-wide text-github-text-muted mr-2">
                you
              </span>
              {message.content}
            </div>
          ) : (
            <div key={index}>
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={11} style={{ color: ACCENT }} />
                <span className="text-[10px] uppercase tracking-wide" style={{ color: ACCENT }}>
                  buddy
                </span>
              </div>
              <div className="prose-buddy text-github-text-secondary leading-relaxed break-words">
                {message.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                ) : (
                  <span className="text-github-text-muted">thinking…</span>
                )}
              </div>
              {message.content && !streaming && (
                <button
                  type="button"
                  onClick={() => onPromoteToComment(message.content)}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-github-text-muted hover:text-github-text-primary cursor-pointer"
                  title="Start a draft comment from this answer"
                >
                  <MessageSquarePlus size={13} />
                  Add as draft comment
                </button>
              )}
            </div>
          ),
        )}
        {error && <div className="text-xs text-github-warning">{error}</div>}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-github-border">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={streaming}
          placeholder="Ask a question about this hunk…"
          className="flex-1 bg-github-bg-primary border border-github-border rounded px-2 py-1 text-sm text-github-text-primary focus:outline-none focus:border-github-text-muted"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={streaming || !input.trim()}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded cursor-pointer disabled:opacity-40 disabled:cursor-default"
          style={{ color: ACCENT, backgroundColor: `${ACCENT}1a` }}
        >
          <Send size={13} />
          Ask
        </button>
      </div>
    </div>
  );
}
