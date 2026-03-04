"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";

export default function Chat() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Billing Agent
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ask about customers, subscriptions, invoices, and revenue
        </p>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center pt-32">
              <div className="text-center">
                <p className="text-lg font-medium text-zinc-400 dark:text-zinc-500">
                  No messages yet
                </p>
                <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-600">
                  Try asking &quot;Show me the revenue summary&quot; or
                  &quot;List all enterprise customers&quot;
                </p>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-white text-zinc-800 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700"
                }`}
              >
                {m.parts?.map((part, i) => {
                  if (part.type === "text") {
                    return (
                      <span key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </span>
                    );
                  }
                  if (part.type === "tool-invocation") {
                    return (
                      <div
                        key={i}
                        className="my-2 rounded-lg bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                      >
                        <span className="font-semibold">
                          {part.toolInvocation.toolName}
                        </span>
                        {part.toolInvocation.state === "result" && (
                          <pre className="mt-1 max-h-32 overflow-auto">
                            {JSON.stringify(part.toolInvocation.result, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700">
                <div className="flex space-x-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-auto max-w-2xl px-4 pb-2">
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error.message}
          </p>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl gap-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about customers, invoices, or revenue..."
            className="flex-1 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-700"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
