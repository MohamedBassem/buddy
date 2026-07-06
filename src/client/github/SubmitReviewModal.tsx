import { X, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { type DiffCommentThread } from '../../types/diff';
import { GitHubIcon } from '../components/GitHubIcon';

import {
  type GitHubPrInfo,
  type ReviewEvent,
  type SubmitReviewFn,
  type SubmitReviewResult,
} from './useGitHubReview';

interface SubmitReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  pr: GitHubPrInfo;
  threads: DiffCommentThread[];
  submit: SubmitReviewFn;
  /** Changed files not yet marked reviewed — surfaced as a coverage nudge. */
  unreviewedFiles: string[];
}

type EventChoice = 'PENDING' | ReviewEvent;

const EVENT_OPTIONS: { value: EventChoice; label: string; hint: string }[] = [
  {
    value: 'PENDING',
    label: 'Pending draft',
    hint: 'Create the review on GitHub without submitting — you finish it there.',
  },
  { value: 'COMMENT', label: 'Comment', hint: 'Submit the comments without approval status.' },
  { value: 'APPROVE', label: 'Approve', hint: 'Submit and approve the pull request.' },
  { value: 'REQUEST_CHANGES', label: 'Request changes', hint: 'Submit and request changes.' },
];

function lineLabel(thread: DiffCommentThread): string {
  const { side, line } = thread.position;
  const loc = typeof line === 'number' ? `${line}` : `${line.start}-${line.end}`;
  return `${thread.filePath}:${side === 'old' ? 'L' : 'R'}${loc}`;
}

/**
 * "Submit review to GitHub" flow. The reviewer picks which local comment threads
 * to include, writes an optional summary, and chooses whether to leave a pending
 * draft or submit with a verdict. This is deliberately separate from the
 * local-only comment UI — nothing reaches GitHub without going through here.
 */
export function SubmitReviewModal({
  isOpen,
  onClose,
  pr,
  threads,
  submit,
  unreviewedFiles,
}: SubmitReviewModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(threads.map((t) => t.id)));
  const [body, setBody] = useState('');
  const [choice, setChoice] = useState<EventChoice>('PENDING');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosenThreads = useMemo(
    () => threads.filter((t) => selected.has(t.id)),
    [threads, selected],
  );

  if (!isOpen) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canSubmit =
    !submitting && (chosenThreads.length > 0 || (choice !== 'PENDING' && choice !== 'COMMENT'));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await submit({
        threads: chosenThreads,
        ...(choice !== 'PENDING' ? { event: choice } : {}),
        ...(body.trim() ? { body } : {}),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-lg border border-github-border bg-github-bg-secondary shadow-xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-github-border">
          <GitHubIcon style={{ height: '16px', width: '16px' }} />
          <span className="text-sm font-semibold text-github-text-primary">
            Submit review to {pr.owner}/{pr.repo} #{pr.number}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-github-text-muted hover:text-github-text-primary cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {result ? (
            <div className="text-sm text-github-text-secondary flex flex-col gap-2">
              <div className="text-github-text-primary font-medium">
                Review created ({result.commentCount} comment
                {result.commentCount === 1 ? '' : 's'}
                {result.state ? `, ${result.state.toLowerCase()}` : ', pending'}).
              </div>
              {result.htmlUrl && (
                <a
                  href={result.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-github-accent hover:underline"
                >
                  Open the review on GitHub <ExternalLink size={13} />
                </a>
              )}
              {result.skipped.length > 0 && (
                <div className="text-xs text-github-warning">
                  Skipped {result.skipped.length}: {result.skipped.join('; ')}
                </div>
              )}
            </div>
          ) : (
            <>
              {unreviewedFiles.length > 0 && (
                <div
                  className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                  style={{
                    borderColor: 'var(--color-github-warning)',
                    backgroundColor:
                      'color-mix(in srgb, var(--color-github-warning) 12%, transparent)',
                  }}
                >
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-github-warning" />
                  <div className="min-w-0">
                    <div className="text-github-text-primary">
                      {unreviewedFiles.length} changed file
                      {unreviewedFiles.length === 1 ? '' : 's'} not yet marked reviewed.
                    </div>
                    <div
                      className="text-xs text-github-text-muted truncate"
                      title={unreviewedFiles.join(', ')}
                    >
                      {unreviewedFiles.slice(0, 4).join(', ')}
                      {unreviewedFiles.length > 4 ? `, +${unreviewedFiles.length - 4} more` : ''}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-github-text-secondary mb-1.5 uppercase tracking-wide">
                  Comments ({chosenThreads.length}/{threads.length})
                </div>
                {threads.length === 0 ? (
                  <div className="text-sm text-github-text-muted">
                    No local comments yet. You can still submit a review with a summary and a
                    verdict below.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {threads.map((thread) => (
                      <label
                        key={thread.id}
                        className="flex items-start gap-2 text-sm cursor-pointer hover:bg-github-bg-tertiary rounded px-1.5 py-1"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(thread.id)}
                          onChange={() => toggle(thread.id)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="font-mono text-xs text-github-text-muted block truncate">
                            {lineLabel(thread)}
                          </span>
                          <span className="text-github-text-secondary line-clamp-2">
                            {thread.messages.map((m) => m.body).join(' ')}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold text-github-text-secondary mb-1.5 uppercase tracking-wide">
                  Summary (optional)
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  placeholder="Overall review summary…"
                  className="w-full bg-github-bg-primary border border-github-border rounded px-2 py-1.5 text-sm text-github-text-primary focus:outline-none focus:border-github-text-muted resize-y"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-github-text-secondary mb-1.5 uppercase tracking-wide">
                  Action
                </div>
                <div className="flex flex-col gap-1.5">
                  {EVENT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="review-event"
                        checked={choice === option.value}
                        onChange={() => setChoice(option.value)}
                        className="mt-1"
                      />
                      <span>
                        <span className="text-github-text-primary">{option.label}</span>
                        <span className="text-xs text-github-text-muted block">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {error && <div className="text-sm text-github-danger">{error}</div>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-github-border">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded border border-github-border text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary cursor-pointer"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-github-accent text-white hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {choice === 'PENDING' ? 'Create pending review' : 'Submit review'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
