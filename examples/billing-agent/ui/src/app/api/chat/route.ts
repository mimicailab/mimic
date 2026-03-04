const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:3002";

export async function POST(req: Request) {
  const body = await req.json();

  // useChat v3 sends UIMessage format (parts array).
  // Convert to ModelMessage format (content string) for the agent.
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

  return new Response(agentRes.body, {
    status: agentRes.status,
    headers: {
      "Content-Type": agentRes.headers.get("Content-Type") ?? "text/event-stream",
    },
  });
}
