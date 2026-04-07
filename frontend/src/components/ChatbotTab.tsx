import { useState, useRef, useEffect } from "react";
import { apiFetch } from "../lib/supabase";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { entry_type: string; entry_id: string; preview: string }[];
}

export default function ChatbotTab({
  campaignId,
  messages,
  setMessages,
}: {
  campaignId: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMsg: ChatMessage = { role: "user", content: query.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setLoading(true);

    const r = await apiFetch(`/campaigns/${campaignId}/chatbot`, {
      method: "POST",
      body: JSON.stringify({ query: userMsg.content }),
    });

    if (r.ok) {
      const data = await r.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, sources: data.sources },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong." },
      ]);
    }

    setLoading(false);
  };

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-header__title">Memory Chatbot</h2>
      </div>

      <div className="chat-shell">
        <div className="chat-box">
          {messages.length === 0 && (
            <div className="chat-empty">
              Ask anything about your campaign — the historian remembers all.
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chat-msg${msg.role === "user" ? " chat-msg--user" : ""}`}
            >
              <div className={`chat-msg__role${msg.role === "user" ? " chat-msg__role--user" : ""}`}>
                {msg.role === "user" ? "You" : "Historian"}
              </div>
              <div className="chat-msg__body">{msg.content}</div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="chat-msg__sources">
                  {msg.sources.map((s, j) => (
                    <span key={j} className="source-pill">
                      {s.entry_type}{s.preview ? `: ${s.preview.slice(0, 40)}…` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="chat-msg">
              <div className="chat-msg__role">Historian</div>
              <div className="chat-msg__body" style={{ color: "var(--tome-400)", fontStyle: "italic" }}>
                Thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSubmit} className="chat-input-bar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about your campaign…"
            disabled={loading}
            className="form-input"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="btn btn--primary"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
