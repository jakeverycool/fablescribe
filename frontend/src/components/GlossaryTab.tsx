import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

interface GlossaryEntry {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  description: string | null;
  tags: string[];
}

const TYPES = ["character", "place", "faction", "event", "item", "lore", "rule", "other"];

export default function GlossaryTab({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/glossary`);
    if (r.ok) setEntries(await r.json());
  };

  useEffect(() => {
    load();
  }, [campaignId]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "15px" }}>Glossary</h3>
        <button onClick={() => setShowCreate(true)} style={styles.btn}>
          + New Entry
        </button>
      </div>

      {showCreate && (
        <GlossaryForm
          campaignId={campaignId}
          onDone={() => { setShowCreate(false); load(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {entries.length === 0 && !showCreate && (
        <p style={{ color: "#555", fontStyle: "italic" }}>No glossary entries yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {entries.map((e) =>
          editing === e.id ? (
            <GlossaryForm
              key={e.id}
              campaignId={campaignId}
              initial={e}
              onDone={() => { setEditing(null); load(); }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={e.id} style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <strong>{e.name}</strong>
                  <span style={styles.badge}>{e.type}</span>
                  {e.aliases.length > 0 && (
                    <span style={{ color: "#666", fontSize: "12px", marginLeft: "8px" }}>
                      aka {e.aliases.join(", ")}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setEditing(e.id)} style={styles.smallBtn}>Edit</button>
                  <button
                    onClick={async () => {
                      await apiFetch(`/campaigns/${campaignId}/glossary/${e.id}`, { method: "DELETE" });
                      load();
                    }}
                    style={{ ...styles.smallBtn, color: "#f87171" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {e.description && <p style={styles.desc}>{e.description}</p>}
              {e.tags.length > 0 && (
                <div style={{ marginTop: "4px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {e.tags.map((t) => (
                    <span key={t} style={styles.tag}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function GlossaryForm({
  campaignId,
  initial,
  onDone,
  onCancel,
}: {
  campaignId: string;
  initial?: GlossaryEntry;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState(initial?.type || "other");
  const [aliases, setAliases] = useState(initial?.aliases.join(", ") || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [tags, setTags] = useState(initial?.tags.join(", ") || "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const body = {
      name,
      type,
      aliases: aliases ? aliases.split(",").map((s) => s.trim()).filter(Boolean) : [],
      description: description || null,
      tags: tags ? tags.split(",").map((s) => s.trim()).filter(Boolean) : [],
    };

    if (initial) {
      await apiFetch(`/campaigns/${campaignId}/glossary/${initial.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } else {
      await apiFetch(`/campaigns/${campaignId}/glossary`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    setSaving(false);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={{ display: "flex", gap: "8px" }}>
        <input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} required style={{ ...styles.input, flex: 1 }} />
        <select value={type} onChange={(e) => setType(e.target.value)} style={styles.input}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <input placeholder="Aliases (comma-separated)" value={aliases} onChange={(e) => setAliases(e.target.value)} style={styles.input} />
      <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={styles.textarea} />
      <input placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} style={styles.input} />
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" disabled={saving} style={styles.btn}>
          {saving ? "Saving..." : initial ? "Update" : "Create"}
        </button>
        <button type="button" onClick={onCancel} style={styles.smallBtn}>Cancel</button>
      </div>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: "12px 16px",
    background: "#1a1a1a",
    borderRadius: "8px",
    border: "1px solid #2a2a2a",
  },
  desc: { margin: "4px 0 0", fontSize: "13px", color: "#888" },
  badge: {
    display: "inline-block",
    marginLeft: "8px",
    padding: "2px 8px",
    borderRadius: "4px",
    background: "#2a2a2a",
    color: "#aaa",
    fontSize: "11px",
  },
  tag: {
    padding: "2px 6px",
    borderRadius: "3px",
    background: "#1e1e3a",
    color: "#a78bfa",
    fontSize: "11px",
  },
  btn: {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "none",
    background: "#7c3aed",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
  smallBtn: {
    background: "none",
    border: "1px solid #333",
    color: "#888",
    padding: "4px 10px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "16px",
    background: "#1a1a1a",
    borderRadius: "8px",
    border: "1px solid #2a2a2a",
    marginBottom: "12px",
  },
  input: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#0f0f0f",
    color: "#e0e0e0",
    fontSize: "13px",
    outline: "none",
  },
  textarea: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#0f0f0f",
    color: "#e0e0e0",
    fontSize: "13px",
    outline: "none",
    minHeight: "60px",
    resize: "vertical" as const,
    fontFamily: "inherit",
  },
};
