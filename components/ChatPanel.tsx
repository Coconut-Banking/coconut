"use client";

import { useState, useRef, useEffect } from "react";

export function ChatPanel() {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      const reply = data.reply ?? data.error ?? "Something went wrong.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Failed to get a response." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-[320px] bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--border)] text-sm font-medium">
        Ask about your spending
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            e.g. &quot;Where am I spending the most?&quot; or &quot;Explain my subscriptions&quot;
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "text-right"
                : "text-left"
            }
          >
            <span
              className={
                m.role === "user"
                  ? "inline-block px-3 py-1.5 rounded-lg bg-[var(--accent)] text-sm"
                  : "inline-block px-3 py-1.5 rounded-lg bg-[var(--border)] text-sm max-w-[90%]"
              }
            >
              {m.content}
            </span>
          </div>
        ))}
        {loading && (
          <p className="text-sm text-[var(--muted)]">Thinking...</p>
        )}
        <div ref={bottomRef} />
      </div>
      <form
        className="p-3 border-t border-[var(--border)] flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your data..."
          className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
