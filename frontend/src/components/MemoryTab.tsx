import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

interface MemoryEntry {
  id: string;
  kind: string;
  visibility: string;
  content: string | null;
  dm_annotation: string | null;
  final_text: string | null;
  source_timestamp: string | null;
  created_at: string;
  character_id: string | null;
  queue_status: string | null;
}

export default function MemoryTab({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);

  const load = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/memory`);
    if (r.ok) setEntries(await r.json());
  };

  useEffect(() => {
    load();
  }, [campaignId]);

  const kindColors: Record<string, string> = {
    note: "#7dd3fc",
    response: "#c084fc",
    event: "#fbbf24",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "15px" }}>Campaign Memory</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => setShowNoteForm(true)} style={styles.btn}>+ Note</button>
          <button onClick={() => setShowEventForm(true)} style={styles.btn}>+ Event</button>
        </div>
      </div>

      {showNoteForm && (
        <EntryForm
          campaignId={campaignId}
          kind="note"
          onDone={() => { setShowNoteForm(false); load(); }}
          onCancel={() => setShowNoteForm(false)}
        />
      )}
      {showEventForm && (
        <EntryForm
          campaignId={campaignId}
          kind="event"
          onDone={() => { setShowEventForm(false); load(); }}
          onCancel={() => setShowEventForm(false)}
        />
      )}

      {entries.length === 0 && !showNoteForm && !showEventForm && (
        <p style={{ color: "#555", fontStyle: "italic" }}>No memory entries yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {entries.map((e) => (
          <div key={e.id} style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ ...styles.badge, background: kindColors[e.kind] || "#555", color: "#0f0f0f" }}>
                  {e.kind}
                </span>
                {e.visibility === "dm_only" && (
                  <span style={{ ...styles.badge, background: "#333", color: "#f87171" }}>DM only</span>
                )}
                <span style={{ color: "#555", fontSize: "11px" }}>
                  {new Date(e.source_timestamp || e.created_at).toLocaleString()}
                </span>
              </div>
              <button
                onClick={async () => {
                  await apiFetch(`/campaigns/${campaignId}/memory/${e.id}`, { method: "DELETE" });
                  load();
                }}
                style={{ ...styles.smallBtn, color: "#f87171" }}
              >Delete</button>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {e.content || e.final_text}
            </p>
            {e.dm_annotation && (
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#888", fontStyle: "italic" }}>
                DM note: {e.dm_annotation}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryForm({
  campaignId, kind, onDone, onCancel,
}: {
  campaignId: string; kind: "note" | "event"; onDone: () => void; onCancel: () => void;
}) {
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);

    await apiFetch(`/campaigns/${campaignId}/memory/${kind}`, {
      method: "POST",
      body: JSON.stringify({ content: content.trim(), visibility }),
    });

    setSaving(false);
    onDone();
  };

  return (
    <form onSubmit={save} style={styles.form}>
      <textarea
        placeholder={kind === "note" ? "Note content..." : "What happened? (e.g., combat outcome, key moment)"}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
        style={styles.textarea}
      />
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={styles.input}>
          <option value="public">Public</option>
          <option value="dm_only">DM Only</option>
        </select>
        <button type="submit" disabled={saving} style={styles.btn}>
          {saving ? "Saving..." : `Create ${kind}`}
        </button>
        <button type="button" onClick={onCancel} style={styles.smallBtn}>Cancel</button>
      </div>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { padding: "12px 16px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #2a2a2a" },
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 },
  btn: { padding: "8px 16px", borderRadius: "6px", border: "none", background: "#7c3aed", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" },
  smallBtn: { background: "none", border: "1px solid #333", color: "#888", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "8px", padding: "16px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #2a2a2a", marginBottom: "12px" },
  input: { padding: "8px 12px", borderRadius: "6px", border: "1px solid #333", background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none" },
  textarea: { padding: "8px 12px", borderRadius: "6px", border: "1px solid #333", background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none", minHeight: "80px", resize: "vertical" as const, fontFamily: "inherit" },
};
