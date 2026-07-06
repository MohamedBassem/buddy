import { AlertTriangle, Info, Radius, Sparkles } from 'lucide-react';

import { type AiAnnotation, type AiAnnotationKind } from '../../types/ai';

const ACCENT = '#a371f7'; // buddy AI accent — distinct from green human comments.

const KIND_META: Record<AiAnnotationKind, { label: string; Icon: typeof Info }> = {
  attention: { label: 'Attention', Icon: AlertTriangle },
  context: { label: 'Context', Icon: Info },
  'blast-radius': { label: 'Blast radius', Icon: Radius },
};

interface AnnotationCardProps {
  annotation: AiAnnotation;
}

/**
 * A single AI annotation, rendered inline in the diff beside human comment
 * threads but visually distinct (purple, sparkle-marked). It flags what
 * deserves attention and why — never a verdict — and states its confidence so
 * the reviewer knows whether the agent read surrounding code or just the hunk.
 */
export function AnnotationCard({ annotation }: AnnotationCardProps) {
  const { label, Icon } = KIND_META[annotation.kind];
  const stale = annotation.stale;

  return (
    <div
      className="rounded-md border bg-github-bg-secondary text-sm"
      style={{
        borderColor: `${ACCENT}66`,
        borderLeft: `3px solid ${ACCENT}`,
        opacity: stale ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-github-border">
        <Sparkles size={13} style={{ color: ACCENT }} />
        <Icon size={13} style={{ color: ACCENT }} />
        <span className="text-xs font-semibold" style={{ color: ACCENT }}>
          {label}
        </span>
        <span
          className="text-[10px] uppercase tracking-wide text-github-text-muted"
          title={
            annotation.confidence === 'looked'
              ? 'The agent read surrounding code, not just this hunk.'
              : 'Inferred from the hunk alone — the agent did not analyze surrounding code.'
          }
        >
          {annotation.confidence === 'looked' ? 'looked around' : 'inferred'}
        </span>
        {stale && (
          <span className="text-[10px] uppercase tracking-wide text-github-warning ml-1">
            stale
          </span>
        )}
        <span className="ml-auto text-[10px] text-github-text-muted">buddy</span>
      </div>
      <div className="px-3 py-2 text-github-text-secondary leading-relaxed whitespace-pre-wrap">
        {annotation.body}
      </div>
    </div>
  );
}
