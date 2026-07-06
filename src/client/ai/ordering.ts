import { type ReviewPlan } from '../../types/ai';
import { type DiffFile } from '../../types/diff';

/**
 * Reorder diff files to match the review plan's narrative order.
 *
 * We re-sort the array itself (rather than overlaying a display order) because
 * difit's keyboard navigation and file map key off array position. Any file not
 * mentioned by the plan keeps its original relative order and is appended after
 * the planned files, so nothing is ever dropped.
 */
export function orderFilesByPlan(files: DiffFile[], plan: ReviewPlan | null): DiffFile[] {
  if (!plan) {
    return files;
  }

  const byPath = new Map(files.map((file) => [file.path, file]));
  const ordered: DiffFile[] = [];
  const used = new Set<string>();

  for (const chapter of plan.chapters) {
    for (const path of chapter.files) {
      const file = byPath.get(path);
      if (file && !used.has(path)) {
        ordered.push(file);
        used.add(path);
      }
    }
  }

  // Preserve original order for anything the plan didn't cover.
  for (const file of files) {
    if (!used.has(file.path)) {
      ordered.push(file);
    }
  }

  return ordered;
}

/** True when two file arrays already list the same paths in the same order. */
export function sameFileOrder(a: DiffFile[], b: DiffFile[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.path !== b[i]?.path) {
      return false;
    }
  }
  return true;
}

/** Map each file path to the 1-based chapter number it belongs to (for headers). */
export function chapterIndexByPath(plan: ReviewPlan | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!plan) {
    return map;
  }
  plan.chapters.forEach((chapter, index) => {
    for (const path of chapter.files) {
      if (!map.has(path)) {
        map.set(path, index);
      }
    }
  });
  return map;
}
