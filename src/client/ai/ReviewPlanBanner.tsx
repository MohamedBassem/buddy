import { Sparkles, ChevronDown, ChevronRight, AlertCircle, History } from 'lucide-react';
import { useState } from 'react';

import {
  type AiAnnotation,
  type AiAnnotationKind,
  type AiPlanStatus,
  type ReviewPlan,
} from '../../types/ai';

interface ReviewPlanBannerProps {
  status: AiPlanStatus;
  plan: ReviewPlan | null;
  message: string | undefined;
  loading: boolean;
  /** Scroll the main diff to a file (chapter navigation). */
  onSelectFile: (filePath: string) => void;
  annotations: AiAnnotation[];
  annotationStatus: AiPlanStatus;
  enabledKinds: Set<AiAnnotationKind>;
  onToggleKind: (kind: AiAnnotationKind) => void;
  /** Files whose diff changed since the reviewer last marked them viewed. */
  changedSinceViewed: string[];
}

const ACCENT = '#a371f7'; // buddy AI accent — visually distinct from green comments.

const KIND_LABELS: Record<AiAnnotationKind, string> = {
  attention: 'Attention',
  context: 'Context',
  'blast-radius': 'Blast radius',
};
const KIND_ORDER: AiAnnotationKind[] = ['attention', 'context', 'blast-radius'];

/**
 * The PR walkthrough banner above the diff: buddy's summary of what the PR does
 * plus the narrative chapters it grouped the files into. Purely assistive — it
 * describes and orders, it never renders a verdict.
 */
export function ReviewPlanBanner({
  status,
  plan,
  message,
  loading,
  onSelectFile,
  annotations,
  annotationStatus,
  enabledKinds,
  onToggleKind,
  changedSinceViewed,
}: ReviewPlanBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  const kindCounts = KIND_ORDER.map((kind) => ({
    kind,
    count: annotations.filter((a) => a.kind === kind).length,
  }));
  const hasAnnotations = annotations.length > 0;

  // Nothing useful to show yet and no work happening: render nothing.
  if (status === 'unavailable' && !message) {
    return null;
  }

  const isWorking = loading || status === 'running' || status === 'idle';

  return (
    <div
      className="bg-github-bg-secondary border border-github-border rounded-md mx-4 mt-3 mb-1 overflow-hidden"
      style={{ borderLeft: `3px solid ${ACCENT}` }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left cursor-pointer hover:bg-github-bg-tertiary transition-colors"
      >
        <Sparkles
          size={16}
          style={{ color: ACCENT }}
          className={isWorking ? 'animate-pulse' : ''}
        />
        <span className="text-sm font-semibold text-github-text-primary">
          {isWorking ? 'Preparing your review…' : 'Review plan'}
        </span>
        {plan && plan.chapters.length > 0 && (
          <span className="text-xs text-github-text-muted">
            {plan.chapters.length} chapter{plan.chapters.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="ml-auto text-github-text-muted">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3">
          {status === 'error' && message && (
            <div className="flex items-start gap-2 text-sm text-github-warning py-1">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          )}
          {status === 'unavailable' && message && (
            <div className="text-sm text-github-text-secondary py-1">{message}</div>
          )}
          {isWorking && !plan && (
            <div className="text-sm text-github-text-secondary py-1">
              Reading the diff and repository to order your review and flag what deserves attention.
            </div>
          )}

          {plan && (
            <>
              {plan.summary && (
                <p className="text-sm text-github-text-secondary leading-relaxed mt-1 mb-3 whitespace-pre-wrap">
                  {plan.summary}
                </p>
              )}
              <ol className="flex flex-col gap-2 m-0 p-0 list-none">
                {plan.chapters.map((chapter, index) => (
                  <li key={`${chapter.title}-${index}`}>
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0"
                        style={{ color: ACCENT, backgroundColor: `${ACCENT}1a` }}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-github-text-primary">
                          {chapter.title}
                        </div>
                        {chapter.summary && (
                          <div className="text-xs text-github-text-secondary leading-snug mt-0.5">
                            {chapter.summary}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {chapter.files.map((file) => (
                            <button
                              key={file}
                              type="button"
                              onClick={() => onSelectFile(file)}
                              className="text-xs font-mono text-github-text-muted hover:text-github-text-primary hover:underline cursor-pointer truncate max-w-full"
                              title={file}
                            >
                              {file.split('/').pop()}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          {(hasAnnotations || annotationStatus === 'running') && (
            <div className="mt-3 pt-3 border-t border-github-border">
              <div className="flex items-center flex-wrap gap-2">
                <span className="text-xs text-github-text-muted mr-1">
                  {annotationStatus === 'running' && !hasAnnotations
                    ? 'Finding what deserves attention…'
                    : 'Annotations:'}
                </span>
                {kindCounts.map(({ kind, count }) => {
                  const on = enabledKinds.has(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => onToggleKind(kind)}
                      disabled={count === 0}
                      className="text-xs px-2 py-0.5 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-default cursor-pointer"
                      style={{
                        color: on ? ACCENT : 'var(--color-github-text-muted)',
                        borderColor: on ? `${ACCENT}66` : 'var(--color-github-border)',
                        backgroundColor: on ? `${ACCENT}1a` : 'transparent',
                      }}
                      title={
                        on
                          ? `Hide ${KIND_LABELS[kind]} annotations`
                          : `Show ${KIND_LABELS[kind]} annotations`
                      }
                    >
                      {KIND_LABELS[kind]} {count > 0 ? count : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {changedSinceViewed.length > 0 && (
            <div className="mt-3 pt-3 border-t border-github-border flex items-center gap-2 flex-wrap">
              <History size={14} className="text-github-warning shrink-0" />
              <span className="text-xs text-github-text-secondary">
                {changedSinceViewed.length} file{changedSinceViewed.length === 1 ? '' : 's'} changed
                since your last pass.
              </span>
              <button
                type="button"
                onClick={() => {
                  const first = changedSinceViewed[0];
                  if (first) onSelectFile(first);
                }}
                className="text-xs px-2 py-0.5 rounded border border-github-border text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary cursor-pointer"
              >
                Jump to first
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
