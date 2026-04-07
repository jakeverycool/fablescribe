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
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 200px)" }}>
      <h3 style={{ margin: "0 0 16px", fontSize: "15px" }}>Campaign Memory Chatbot</h3>

      <div style={styles.chatBox}>
        {messages.length === 0 && (
          <p style={{ color: "#555", fontStyle: "italic", padding: "16px" }}>
            Ask anything about your campaign. The chatbot searches your curated memory, characters, and glossary.
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ ...styles.message, ...(msg.role === "user" ? styles.userMsg : styles.assistantMsg) }}>
            <span style={styles.roleLabel}>
              {msg.role === "user" ? "You" : "Historian"}
            </span>
            <p style={{ margin: "4px 0 0", fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {msg.content}
            </p>
            {msg.sources && msg.sources.length > 0 && (
              <div style={{ marginTop: "8px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {msg.sources.map((s, j) => (
                  <span key={j} style={styles.sourcePill}>
                    {s.entry_type}{s.preview ? `: ${s.preview.slice(0, 40)}...` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ ...styles.message, ...styles.assistantMsg }}>
            <span style={styles.roleLabel}>Historian</span>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#666" }}>Thinking...</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} style={styles.inputBar}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about your campaign..."
          disabled={loading}
          style={styles.input}
        />
        <button type="submit" disabled={loading || !query.trim()} style={styles.sendBtn}>
          Send
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  chatBox: {
    flex: 1,
    overflowY: "auto",
    background: "#0a0a0a",
    border: "1px solid #2a2a2a",
    borderRadius: "8px 8px 0 0",
  },
  message: {
    padding: "12px 16px",
    borderBottom: "1px solid #1a1a1a",
  },
  userMsg: { background: "#111118" },
  assistantMsg: { background: "#0a0a0a" },
  roleLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#7c3aed",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  sourcePill: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "4px",
    background: "#1e1e3a",
    color: "#a78bfa",
    fontSize: "10px",
  },
  inputBar: {
    display: "flex",
    gap: "8px",
    padding: "12px",
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderTop: "none",
    borderRadius: "0 0 8px 8px",
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#0f0f0f",
    color: "#e0e0e0",
    fontSize: "13px",
    outline: "none",
  },
  sendBtn: {
    padding: "10px 20px",
    borderRadius: "6px",
    border: "none",
    background: "#7c3aed",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
};
