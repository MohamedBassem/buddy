# Buddy — AI-assisted PR review

An AI-_assisted_ (not AI-automated) PR review tool, forked from [difit](https://github.com/yoshiko-pg/difit) (MIT). The AI prepares the review — ordering, annotations, context — and answers questions; the human reads, judges, and authors the comments.

## Why difit

- MIT, 2.9k stars, actively maintained, small single-purpose codebase (React 19 + Vite + Express 5 + simple-git, no state library).
- Already has: GitHub-like diff UI, `--pr <url>` fetching via `gh` CLI, inline comments anchored to file/side/line, import of existing PR review threads, SSE push channel, generated-file auto-collapse, keyboard nav.
- Missing (ours to build): everything AI, and any GitHub _write_ path — difit is strictly read-only today.

Rejected alternatives: **diffity** (closest feature match but PolyForm Shield license forbids forking into a competing tool), **Plannotator** (agent-initiated architecture, heavy monorepo), **hunk** (TUI), **from scratch** (weeks of diff-rendering work before any AI feature).

## difit anatomy (fork-relevant)

```
src/
  cli/index.ts        commander entry; --pr mode: gh pr diff → unified diff,
                      gh api graphql → existing review threads (github.ts)
  server/server.ts    Express; GET /api/diff, POST /api/comments,
                      SSE /api/watch (reload + commentsChanged events)
  server/git-diff.ts  simple-git + hand-written unified-diff parser
  types/diff.ts       DiffFile / DiffChunk / DiffLine / DiffCommentThread —
                      shared server↔client; THE place to extend the data model
  client/App.tsx      1531-line god component; all state in useState/localStorage
  client/components/  FileList (sidebar), DiffViewer → DiffChunk → DiffLineRow,
                      CommentThreadCard, CommentForm
  utils/commentFormatting.ts  file:line prompt formatting (reuse for AI context)
```

Key facts learned from the code:

- File order is implicit git order, consumed as array position in two places (`App.tsx` main map + `FileList.buildFileTree`); keyboard nav keys off array index → **re-sort the array itself**, don't overlay a display order.
- Comments live in localStorage + an in-memory server session with a version-merge protocol that is already delicate → **AI artifacts get their own state**, never piggyback on the comment session.
- Server state is ephemeral by design (dies with the tab) → AI results that should survive restarts go to a disk cache.
- Lazy rendering means off-screen hunks aren't mounted → AI passes operate on `diffData`, never the DOM.
- Auto-collapse is a side effect of "viewed" state (`useViewedFiles`) → noise triage extends that hook, not a parallel collapse mechanism.
- `viewers/registry.ts` (Text/Markdown/Notebook/Image viewers) is a clean strategy pattern; per-hunk UI slots into `DiffChunk` next to `CommentThreadCard`.

## Architecture

```
┌ browser ─────────────────────────────────────────────┐
│ difit UI  + chapters sidebar + annotation cards      │
│           + per-hunk Ask-AI panel + review ledger    │
└──────────────┬───────────────────────▲───────────────┘
        fetch/POST                SSE /api/watch (+ new ai events)
┌──────────────▼───────────────────────┴───────────────┐
│ Express server (existing)                            │
│  + src/server/ai/  ← ALL new server code lives here  │
│     agent runner (Claude Agent SDK)                  │
│     tools: read repo files, git log/blame, gh api    │
│     disk cache keyed by (repo, PR, head SHA)         │
│  + src/server/github-write.ts  (pending review post) │
└──────────────────────────────────────────────────────┘
              gh CLI (auth reuse — no token storage)
```

**Fork hygiene:** all new code in `src/server/ai/`, `src/client/ai/`, `src/types/ai.ts`; edits to upstream files kept to narrow injection points (route registration, `DiffChunk` render slot, `FileList` grouping, `App.tsx` wiring). Track upstream as a remote; rebase periodically. AI client state goes in a small zustand store rather than more `useState` in App.tsx.

**AI backend:** Claude Agent SDK. One agent session per (PR, head SHA). The prep pass (ordering + annotations + triage) runs once on load, streams results over SSE as they land, and is cached on disk so reopening a PR is instant. The agent gets tools to read the checked-out repo (clone/fetch the PR head if not local), run `git log`/`blame`, and query `gh api` — it must see beyond the diff.

## Data model (src/types/ai.ts)

```ts
interface ReviewPlan {
  headSha: string;
  summary: string; // 3–5 sentence PR walkthrough
  chapters: {
    // narrative grouping + order
    title: string; // "1. Schema change"
    summary: string;
    files: string[]; // paths, in review order
  }[];
  triage: Record<string, 'substantive' | 'mechanical'>; // path → class
}

interface AiAnnotation {
  id: string;
  anchor: { filePath: string; side: 'old' | 'new'; line: number; headSha: string };
  kind: 'attention' | 'context' | 'blast-radius';
  body: string; // "changes retry semantics: was 3 attempts, now unbounded"
  confidence: 'looked' | 'inferred'; // did the agent read surrounding code or just the hunk
}

interface HunkChat {
  id: string;
  anchor: AiAnnotation['anchor'];
  messages: { role: 'user' | 'assistant'; content: string }[];
}
```

Anchors always carry `headSha`. On PR update, annotations re-anchor or mark stale — never silently drift.

## Features → hook points

| Feature                    | Server                                                                                                                                                                                                                                                  | Client                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Review ordering + chapters | New `GET /api/ai/plan` (kicks prep pass, returns cached if fresh); SSE event `aiPlanReady`                                                                                                                                                              | Re-sort `diffData.files` per plan when it arrives; chapter headers in `FileList`; PR summary banner above main pane                             |
| Attention annotations      | Prep pass emits `AiAnnotation[]`; `GET /api/ai/annotations`; SSE `aiAnnotationsChanged` (mirrors existing `commentsChanged` precedent)                                                                                                                  | New `AnnotationCard` rendered in `DiffChunk` beside `CommentThreadCard`; visually distinct from human comments; per-kind toggle                 |
| Noise triage               | `triage` in ReviewPlan (extends existing `isGeneratedFile` signal)                                                                                                                                                                                      | Feed into `useViewedFiles` auto-mark path → auto-collapse with "mechanical: rename-only" badge                                                  |
| Ask-AI hunk chat           | `POST /api/ai/ask` — streams response (SSE or fetch stream); context = hunk + full file + agent tools on demand; reuse `commentFormatting.ts` for anchor formatting                                                                                     | Chat panel in `DiffChunk` (same injection point as `CommentForm`); "promote answer to draft comment" button copies into a normal comment thread |
| GitHub comment posting     | New `src/server/github-write.ts`: map `DiffCommentThread.position` → GitHub path/line/side (inverse of the read mapping in `cli/github.ts:146-225`); batch as **pending review** via `gh api` GraphQL `addPullRequestReview`; `POST /api/github/review` | "Submit review" flow: pick threads to include, edit, choose approve/comment/request-changes; clearly separated from local-only comments         |
| Coverage ledger            | —                                                                                                                                                                                                                                                       | Extends existing viewed/collapsed state: hunk-level reviewed/skipped marks, progress bar in header, "N hunks unreviewed" before submit          |
| Interdiff / re-review      | On new head SHA: diff old-head..new-head, re-anchor annotations & viewed-state, mark stale                                                                                                                                                              | "Changes since your last pass" filter mode                                                                                                      |

## Milestones

**M0 — Fork & foundation** (small)
Fork, rename, strip `src/site/` demo and `packages/vscode`. Dev loop green (`pnpm dev`, tests pass). Add `src/{server,client}/ai/` skeleton + zustand store + disk cache module. Decide agent SDK wiring, `ANTHROPIC_API_KEY` handling.

**M1 — Review plan** (the killer feature; first daily-usable build)
Prep-pass agent produces `ReviewPlan` from the PR diff + repo access. Chapters in sidebar, files re-sorted, PR summary banner, mechanical-file auto-collapse with badges. Cache by head SHA. _Exit test: open a real 30-file PR, ordering feels like a narrative, mechanical noise is folded._

**M2 — Annotations**
Prep pass also emits anchored `AiAnnotation`s (attention flags, context notes), streamed in via SSE. Rendering, toggles, confidence marks ("didn't analyze X" is stated, not implied).

**M3 — Ask-AI chat**
Per-hunk chat with streaming responses and repo-tool access. "Promote to draft comment" bridges AI answer → human-authored comment.

**M4 — GitHub write-back**
Pending-review batching, thread→GitHub position mapping, submit flow. This is the point where buddy replaces the GitHub review tab entirely.

**M5 — Review durability**
Coverage ledger, interdiff on force-push, annotation re-anchoring. (This is the retention feature — schedule it before polish.)

## Risks

- **Anchor staleness** — every AI artifact carries `headSha`; re-anchor-or-mark-stale is designed in from M1, not retrofitted.
- **Comment-session races** — AI state stays out of the version-merged comment session entirely; only human-promoted comments enter it.
- **Prep-pass latency/cost** — UI renders git-order immediately; plan/annotations stream in and re-sort when ready; disk cache makes reopen free. Target: usable at 0s, ordered within ~30s.
- **Fork divergence** — new-directory isolation + upstream remote; accept that `App.tsx` wiring will need care on rebases.
- **Automation bias** — annotations flag _what deserves attention and why_, never verdicts; unanalyzed areas are labeled; coverage ledger keeps the human honest about what they actually looked at.
