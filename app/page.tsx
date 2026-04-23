"use client";

import { useChat } from "@ai-sdk/react";
import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SAMPLE_PROMPTS = [
  "When should I use the Merge node vs Compare Datasets?",
  "My webhook fires twice for one event. Where do I look?",
  "How do I loop over items and call an HTTP API without hitting rate limits?",
  "Paste a workflow JSON to get it debugged with cited fixes",
];

function messageText(m: { parts?: Array<{ type: string; text?: string }> }): string {
  return (
    m.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("") ?? ""
  );
}

export default function Home() {
  const { messages, sendMessage, status, error, setMessages, clearError } = useChat({
    experimental_throttle: 50,
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const resetChat = () => {
    setMessages([]);
    setInput("");
    clearError();
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || status === "streaming" || status === "submitted") return;
    clearError();
    sendMessage({ text: trimmed });
    setInput("");
  };

  const isEmpty = messages.length === 0;
  const isWorking = status === "streaming" || status === "submitted";

  return (
    <div className="min-h-[100dvh] flex flex-col bg-bg text-text">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-baseline justify-between gap-3">
          <button
            onClick={resetChat}
            className="flex items-baseline gap-3 text-left active:scale-[0.98] transition"
            aria-label="Start a new chat"
          >
            <h1 className="font-serif text-2xl leading-none hover:text-accent transition">
              n8n Workflow Coach
            </h1>
            <span className="text-text-dim text-sm hidden sm:inline">grounded in the n8n docs</span>
          </button>
          {!isEmpty && (
            <button
              onClick={resetChat}
              className="text-sm text-text-dim hover:text-accent transition shrink-0"
            >
              + New chat
            </button>
          )}
        </div>
      </header>

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-10"
      >
        <div className="max-w-3xl mx-auto">
          {isEmpty ? (
            <div className="pt-16">
              <h2 className="font-serif text-4xl leading-tight mb-3">
                Ask anything about <span className="text-accent">n8n</span>.
              </h2>
              <p className="text-text-dim text-lg mb-10 max-w-xl">
                I answer from the official n8n documentation and cite my sources. Paste a broken
                workflow to debug it, or ask how a specific node works.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => submit(p)}
                    className="text-left text-sm text-text-dim border border-border rounded-lg px-4 py-3 hover:border-accent hover:text-text active:scale-[0.98] transition"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {messages.map((m) => (
                <Message key={m.id} role={m.role} text={messageText(m)} />
              ))}
              {isWorking && messages.at(-1)?.role === "user" && <ThinkingDots />}
              {error && (
                <div className="text-sm text-highlight border border-highlight/30 rounded-lg p-3">
                  Something went wrong: {error.message}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="border-t border-border px-6 py-4 bg-bg"
      >
        <div className="max-w-3xl mx-auto flex gap-3 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            autoFocus
            placeholder="Ask about a node, paste a workflow JSON to debug, describe a bug…"
            className="flex-1 resize-none bg-bg-elevated border border-border rounded-lg px-4 py-3 text-[16px] sm:text-[17px] leading-relaxed focus:outline-none focus:border-accent max-h-48"
          />
          <button
            type="submit"
            disabled={!input.trim() || isWorking}
            className="shrink-0 bg-accent text-bg font-medium px-5 py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition"
          >
            {isWorking ? "…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}

const Message = memo(function Message({ role, text }: { role: string; text: string }) {
  if (role === "user") {
    return (
      <div className="border-l-2 border-accent pl-4">
        <div className="text-xs uppercase tracking-wider text-text-dim mb-1">You</div>
        <div className="prose-chat whitespace-pre-wrap">{text}</div>
      </div>
    );
  }
  return (
    <div className="pl-4">
      <div className="text-xs uppercase tracking-wider text-text-dim mb-1">Coach</div>
      <div className="prose-chat">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
});

function ThinkingDots() {
  return (
    <div className="pl-4 text-text-dim flex items-center gap-1">
      <span className="animate-pulse">●</span>
      <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>
        ●
      </span>
      <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>
        ●
      </span>
    </div>
  );
}
