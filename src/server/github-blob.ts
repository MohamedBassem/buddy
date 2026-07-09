import { spawn } from 'child_process';

import { type AiRepoContext } from '../types/ai.js';

type PrContext = NonNullable<AiRepoContext['pr']>;

/** Run `gh` capturing raw stdout bytes (no encoding). Rejects on non-zero exit. */
function runGhRaw(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(new Error(stderr.trim() || `gh exited with code ${code ?? 'null'}`));
      }
    });
  });
}

/**
 * Fetch a file's raw bytes from GitHub at a given ref via `gh api`.
 *
 * Used to serve context-expansion blobs in `--pr` mode: the diff is a stdin
 * patch (`gh pr diff`) and the underlying files aren't checked out locally, so
 * the working-tree/git-object path in GitDiffParser has nothing to read. Auth is
 * reused from the gh CLI (buddy stores no token), matching the write-back path.
 */
export async function fetchGitHubBlob(
  pr: PrContext,
  filepath: string,
  ref: string,
): Promise<Buffer> {
  const encodedPath = filepath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const endpoint = `repos/${pr.owner}/${pr.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  return runGhRaw([
    'api',
    '--hostname',
    pr.hostname,
    endpoint,
    // Raw media type returns the file bytes directly instead of base64 JSON.
    '-H',
    'Accept: application/vnd.github.raw',
  ]);
}

/** Count lines in a file buffer (trailing newline does not add a phantom line). */
export function countBufferLines(buffer: Buffer): number {
  let count = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) count++; // newline byte
  }
  if (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a) {
    count++;
  }
  return count;
}
