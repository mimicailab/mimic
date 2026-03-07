"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function PlatformBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {label}
    </span>
  );
}

const SUGGESTED_PROMPTS = [
  "What's our MRR right now?",
  "I have an investor meeting Thursday. Give me the full picture.",
  "Why is our money down this week?",
  "Are we going to hit £150k MRR by June?",
  "Are any customers paying for a plan they're not using?",
  "Give me an honest picture before the board meeting.",
];

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none wrap-break-word text-zinc-800 dark:prose-invert dark:text-zinc-200 prose-p:my-2 prose-headings:mb-2 prose-headings:mt-4 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-hr:my-4 prose-strong:text-inherit prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:text-inherit before:prose-code:content-none after:prose-code:content-none dark:prose-code:bg-zinc-900/80">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs sm:text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-zinc-300 dark:border-zinc-600">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold text-zinc-900 dark:text-zinc-100">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-t border-zinc-200 px-3 py-2 align-top dark:border-zinc-700">
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-zinc-300 pl-4 italic text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-zinc-200 dark:border-zinc-700" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default function Chat() {
  const { messages, sendMessage, stop, status, error } = useChat();
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
        <div className="mx-auto max-w-2xl">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            CFO Agent
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Verida Analytics · 8 billing platforms · PostgreSQL
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["Stripe", "Paddle", "Chargebee", "GoCardless", "RevenueCat", "Lemon Squeezy", "Zuora", "Recurly"].map(
              (p) => <PlatformBadge key={p} label={p} />,
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="pt-16">
              <p className="text-center text-sm text-zinc-400 dark:text-zinc-500 mb-6">
                Ask me anything about your revenue, metrics, churn, or billing platforms.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage({ text: prompt })}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  >
                    {prompt}
                  </button>
                ))}
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
                    return m.role === "assistant" ? (
                      <MarkdownMessage key={i} text={part.text} />
                    ) : (
                      <span key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </span>
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
            placeholder="Ask about revenue, churn, billing platforms..."
            className="flex-1 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-700"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={() => stop()}
              className="rounded-xl bg-red-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
