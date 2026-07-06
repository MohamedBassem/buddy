import { Sparkles, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useState } from 'react';

import { type AiPlanStatus, type ReviewPlan } from '../../types/ai';

interface ReviewPlanBannerProps {
  status: AiPlanStatus;
  plan: ReviewPlan | null;
  message: string | undefined;
  loading: boolean;
  /** Scroll the main diff to a file (chapter navigation). */
  onSelectFile: (filePath: string) => void;
}

const ACCENT = '#a371f7'; // buddy AI accent — visually distinct from green comments.

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
}: ReviewPlanBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

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
        </div>
      )}
    </div>
  );
}
