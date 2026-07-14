"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SAMPLE_PROMPTS = [
  { text: "When should I use the Merge node vs Compare Datasets?", spec: "node choice" },
  { text: "My webhook fires twice for one event. Where do I look?", spec: "debugging" },
  {
    text: "How do I loop over items and call an HTTP API without hitting rate limits?",
    spec: "flow control",
  },
  { text: "Paste a workflow JSON to get it debugged with cited fixes", spec: "workflow debug" },
];

/**
 * What the endpoint says it DID for one answer, read off the response headers it already
 * emits (X-Coach-Mode / X-Coach-Docs / X-Coach-Nodes). Nothing here is re-derived on the
 * client: the trace under an answer is the server's own report of its retrieval, not the
 * UI's guess at it.
 */
type CoachTrace = {
  mode: string;
  docIds: string[];
  nodes: number;
};

function messageText(m: { parts?: Array<{ type: string; text?: string }> }): string {
  return (
    m.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("") ?? ""
  );
}

/** `docs__integrations__builtin__core-nodes__merge` → `integrations / builtin / core-nodes / merge`. */
function docPath(id: string): string {
  return id
    .split("__")
    .filter((s) => s && s !== "docs")
    .join(" / ");
}

export default function Home() {
  // A trace belongs to an answer, not to a moment. The key is the answer's SLOT — the
  // number of user turns already in the request minus one — so a retry (`regenerate`,
  // which re-sends the same user turns) overwrites the trace of the answer it replaces
  // instead of appending a phantom one and shifting every later answer's trace by one.
  const [traces, setTraces] = useState<Record<number, CoachTrace>>({});

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          const res = await fetch(input as RequestInfo, init);
          if (!res.ok) return res; // an error carries no retrieval to report
          const mode = res.headers.get("X-Coach-Mode");
          if (!mode) return res;

          let slot = -1;
          try {
            const body = JSON.parse(String(init?.body ?? "")) as {
              messages?: Array<{ role: string }>;
            };
            slot = (body.messages ?? []).filter((m) => m.role === "user").length - 1;
          } catch {
            return res; // cannot place it, so do not show it
          }
          if (slot < 0) return res;

          const docs = res.headers.get("X-Coach-Docs") ?? "";
          const trace: CoachTrace = {
            mode,
            // A redirect is shown NO documentation, so it has no sources — the header still
            // lists what retrieval fetched before the gate refused, and printing that under
            // an ungrounded refusal would claim a grounding the answer does not have.
            docIds: mode === "redirect" ? [] : docs.split(",").filter(Boolean),
            nodes: Number(res.headers.get("X-Coach-Nodes") ?? 0) || 0,
          };
          setTraces((t) => ({ ...t, [slot]: trace }));
          return res;
        },
      }),
    []
  );

  const { messages, sendMessage, status, error, setMessages, clearError, stop, regenerate } =
    useChat({ transport, experimental_throttle: 50 });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const resetChat = useCallback(() => {
    stop();
    setMessages([]);
    setTraces({});
    setInput("");
    clearError();
  }, [stop, setMessages, clearError]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const isEmpty = messages.length === 0;
  const isWorking = status === "streaming" || status === "submitted";

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isWorking) return;
    clearError();
    sendMessage({ text: trimmed });
    setInput("");
  };

  // Assistant messages arrive in order, so the nth of them is the answer to the nth user
  // turn, which is the slot its trace was filed under.
  let answerIndex = -1;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-paper text-ink">
      <header className="border-b-2 border-ink px-6">
        <div className="max-w-3xl mx-auto flex items-end justify-between gap-4 py-4">
          <div className="flex items-baseline gap-4">
            <h1 className="text-[26px] font-semibold leading-none tracking-[-0.01em]">
              n8n Workflow Coach
            </h1>
            <span className="kicker text-muted hidden sm:inline">Grounded in the n8n docs</span>
          </div>
          {!isEmpty && (
            <button
              onClick={resetChat}
              className="kicker shrink-0 border border-ink px-3 py-1.5 hover:bg-ink hover:text-paper transition-colors"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      <main ref={scrollRef} className={`flex-1 overflow-y-auto px-6 ${isEmpty ? "graph" : ""}`}>
        <div className="max-w-3xl mx-auto">
          {isEmpty ? (
            <div className="pt-16 pb-10">
              <h2 className="text-[clamp(36px,5.4vw,58px)] font-medium leading-[1.02] tracking-[-0.02em] max-w-[15ch]">
                Ask anything about <em className="italic text-pine">n8n</em>.
              </h2>
              <p className="mt-6 max-w-[46ch] text-[20px] leading-[1.5] text-muted">
                Every answer comes from the official n8n documentation, and every link is a page
                retrieval put in front of the model. Paste a workflow to have it debugged.
              </p>

              <div className="mt-12 border-t-2 border-ink">
                {SAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={p.text}
                    onClick={() => submit(p.text)}
                    className="group w-full grid grid-cols-[44px_1fr_auto] gap-4 items-baseline text-left py-4 border-b border-line hover:bg-tint transition-colors"
                  >
                    <span className="font-mono text-[13px] font-semibold text-pine">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[19px] leading-snug group-hover:translate-x-1 transition-transform">
                      {p.text}
                    </span>
                    <span className="kicker text-muted hidden sm:inline text-right">{p.spec}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="py-10 space-y-9"
              role="log"
              aria-live="polite"
              aria-atomic="false"
              aria-busy={isWorking}
            >
              {messages.map((m) => {
                if (m.role !== "user") answerIndex++;
                return (
                  <Message
                    key={m.id}
                    role={m.role}
                    text={messageText(m)}
                    trace={m.role === "user" ? undefined : traces[answerIndex]}
                  />
                );
              })}

              {isWorking && messages.at(-1)?.role === "user" && <Working />}

              {error && (
                <div className="border-l-2 border-danger pl-4">
                  <div className="kicker text-danger">Failed</div>
                  <p className="mt-1 text-[17px]">
                    {error.message || "The coach could not answer that request."}
                  </p>
                  <button
                    onClick={() => {
                      clearError();
                      regenerate();
                    }}
                    className="kicker mt-3 border border-ink px-3 py-1.5 hover:bg-ink hover:text-paper transition-colors"
                  >
                    Retry
                  </button>
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
        className="border-t border-line bg-paper px-6 py-4"
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
            aria-label="Ask the coach"
            placeholder="Ask about a node, paste a workflow JSON to debug, describe a bug..."
            className="flex-1 resize-none bg-white border border-line px-4 py-3 text-[17px] leading-relaxed focus:outline-none focus:border-pine max-h-48"
          />
          {isWorking ? (
            <button
              type="button"
              onClick={stop}
              className="kicker shrink-0 border-[1.5px] border-ink px-5 py-3.5 text-ink hover:bg-ink hover:text-paper transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="kicker shrink-0 border-[1.5px] border-ink bg-ink px-5 py-3.5 text-paper hover:bg-pine hover:border-pine disabled:opacity-35 disabled:hover:bg-ink disabled:hover:border-ink transition-colors"
            >
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

const Message = memo(function Message({
  role,
  text,
  trace,
}: {
  role: string;
  text: string;
  trace?: CoachTrace;
}) {
  if (role === "user") {
    return (
      <div className="border-l-2 border-pine pl-4">
        <div className="kicker text-muted mb-1">You</div>
        <div className="prose-chat whitespace-pre-wrap">{text}</div>
      </div>
    );
  }

  return (
    <div className="pl-4">
      <div className="kicker text-muted mb-1">Coach</div>
      {trace && <Trace trace={trace} />}
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

const MODE_LABEL: Record<string, string> = {
  answer: "Answer from docs",
  debug: "Workflow debug",
  redirect: "Off-topic, declined",
};

/** The retrieval, made visible: what the endpoint routed to, and what it read to answer. */
function Trace({ trace }: { trace: CoachTrace }) {
  // Open state is OWNED here. Passing `open` as a prop would re-assert it on every render,
  // and this component re-renders on every streamed token — a reader who collapsed the
  // panel mid-answer would watch it spring back open with the next word.
  const [open, setOpen] = useState(true);

  const facts = [
    MODE_LABEL[trace.mode] ?? trace.mode,
    trace.nodes > 0 ? `${trace.nodes} nodes parsed` : null,
    trace.docIds.length > 0
      ? `${trace.docIds.length} docs retrieved`
      : trace.mode === "redirect"
        ? "no docs used"
        : null,
  ].filter(Boolean) as string[];

  return (
    <details
      className="mb-4 border border-line bg-tint/40"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="kicker text-muted cursor-pointer list-none px-3 py-2 flex items-center gap-2">
        <span aria-hidden className="text-pine">
          &#9679;
        </span>
        {facts.join(" · ")}
      </summary>
      {trace.docIds.length > 0 && (
        <ol className="border-t border-line">
          {trace.docIds.map((id, i) => (
            <li
              key={id}
              className="grid grid-cols-[36px_1fr] gap-2 px-3 py-1.5 border-b border-line last:border-b-0"
            >
              <span className="font-mono text-[11px] font-semibold text-pine pt-[3px]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[11.5px] leading-relaxed text-muted break-all">
                {docPath(id)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function Working() {
  return (
    <div className="pl-4">
      <div className="kicker text-muted mb-1">Coach</div>
      <div className="kicker text-pine animate-pulse">Retrieving documentation...</div>
    </div>
  );
}
