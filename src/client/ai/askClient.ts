/**
 * Client for the per-hunk "Ask buddy" streaming endpoint.
 *
 * POSTs the question + hunk context to /api/ai/ask and reads the agent's answer
 * back as plain-text chunks, invoking `onChunk` as each arrives so the UI can
 * render the reply as it streams.
 */

export interface AskBody {
  filePath: string;
  side: 'old' | 'new';
  line: number;
  question: string;
  hunkContent?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export async function streamAsk(
  body: AskBody,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/ai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    let message = `Ask request failed: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // non-JSON error body; keep the default message
    }
    throw new Error(message);
  }

  if (!response.body) {
    // No streaming body available; fall back to the whole text.
    onChunk(await response.text());
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      onChunk(decoder.decode(value, { stream: true }));
    }
  }
}
