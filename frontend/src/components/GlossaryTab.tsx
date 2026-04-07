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
      <div className="tab-header">
        <h2 className="tab-header__title">Glossary</h2>
        <div className="tab-header__actions">
          <button onClick={() => setShowCreate(true)} className="btn btn--primary">
            + New Entry
          </button>
        </div>
      </div>

      {showCreate && (
        <GlossaryForm
          campaignId={campaignId}
          onDone={() => { setShowCreate(false); load(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {entries.length === 0 && !showCreate && (
        <div className="empty-state">
          <div className="empty-state__title">An empty index awaits.</div>
          <p className="empty-state__body">
            Add the names, places, factions, and lore that matter so the chatbot can recall them.
          </p>
        </div>
      )}

      <div className="list-stack">
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
            <div key={e.id} className="list-card">
              <div className="list-card__header">
                <div>
                  <div className="list-card__title">{e.name}</div>
                  <div className="list-card__meta">
                    <span className="badge badge--neutral">{e.type}</span>
                    {e.aliases.length > 0 && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        aka {e.aliases.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="list-card__actions">
                  <button onClick={() => setEditing(e.id)} className="btn btn--secondary btn--sm">Edit</button>
                  <button
                    onClick={async () => {
                      await apiFetch(`/campaigns/${campaignId}/glossary/${e.id}`, { method: "DELETE" });
                      load();
                    }}
                    className="btn btn--ghost btn--sm"
                    style={{ color: "var(--danger)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {e.description && <div className="list-card__body">{e.description}</div>}
              {e.tags.length > 0 && (
                <div className="list-card__footer">
                  {e.tags.map((t) => <span key={t} className="tag">{t}</span>)}
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
    <form onSubmit={handleSubmit} className="form-panel">
      <div className="form-panel__title">{initial ? "Edit entry" : "New entry"}</div>

      <div className="form-group">
        <label className="form-label">Name *</label>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="form-input"
            style={{ flex: 1 }}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="form-select"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Aliases</label>
        <input
          placeholder="Comma-separated"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          className="form-input"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="form-textarea"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Tags</label>
        <input
          placeholder="Comma-separated"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="form-input"
        />
      </div>

      <div className="form-panel__actions">
        <button type="submit" disabled={saving} className="btn btn--primary">
          {saving ? "Saving…" : initial ? "Update" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn--ghost">Cancel</button>
      </div>
    </form>
  );
}
