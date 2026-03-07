const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:3003";

/**
 * Translates the old AI SDK v1 data stream (0:, 9:, a:, d:) into
 * the new AI SDK v6 UI message stream (SSE with JSON objects).
 */
function translateStream(oldStream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = oldStream.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let textPartStarted = false;
  let startSent = false;
  const textPartId = crypto.randomUUID();

  let enqueued = false;

  function enqueue(controller: ReadableStreamDefaultController, data: Uint8Array) {
    controller.enqueue(data);
    enqueued = true;
  }

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            processLine(buffer, controller);
          }
          if (textPartStarted) {
            enqueue(controller, sse({ type: "text-end", id: textPartId }));
          }
          enqueue(controller, sse({ type: "finish-step" }));
          enqueue(controller, sse({ type: "finish", finishReason: "stop" }));
          enqueue(controller, encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line, controller);
        }

        // Only return from pull() if we actually enqueued data for the consumer
        if (enqueued) {
          enqueued = false;
          return;
        }
      }
    },
  });

  function sse(obj: unknown): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
  }

  function ensureStart(controller: ReadableStreamDefaultController) {
    if (!startSent) {
      enqueue(controller, sse({ type: "start" }));
      enqueue(controller, sse({ type: "start-step" }));
      startSent = true;
    }
  }

  function processLine(line: string, controller: ReadableStreamDefaultController) {
    const trimmed = line.trim();
    if (!trimmed) return;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) return;

    const type = trimmed.slice(0, colonIdx);
    const payload = trimmed.slice(colonIdx + 1);

    try {
      switch (type) {
        case "0": {
          const text = JSON.parse(payload) as string;
          ensureStart(controller);
          if (!textPartStarted) {
            enqueue(controller, sse({ type: "text-start", id: textPartId }));
            textPartStarted = true;
          }
          enqueue(controller, sse({ type: "text-delta", id: textPartId, delta: text }));
          break;
        }
        case "9":
        case "a":
          // Tool calls handled internally by the agent — skip in UI stream
          break;
        case "d": {
          // Finish — handled in done
          break;
        }
        default:
          break;
      }
    } catch {
      // Skip malformed lines
    }
  }
}

export async function POST(req: Request) {
  const body = await req.json();

  const messages = (body.messages ?? []).map(
    (m: { role: string; parts?: { type: string; text?: string }[]; content?: string }) => ({
      role: m.role,
      content:
        m.content ??
        (m.parts ?? [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join(""),
    }),
  );

  const agentRes = await fetch(`${AGENT_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!agentRes.ok || !agentRes.body) {
    return new Response(agentRes.body, { status: agentRes.status });
  }

  return new Response(translateStream(agentRes.body), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
