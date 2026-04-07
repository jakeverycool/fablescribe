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

const kindBadge: Record<string, string> = {
  note: "badge--info",
  response: "badge--neutral",
  event: "badge--warning",
};

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

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-header__title">Campaign Memory</h2>
        <div className="tab-header__actions">
          <button onClick={() => setShowNoteForm(true)} className="btn btn--primary">+ Note</button>
          <button onClick={() => setShowEventForm(true)} className="btn btn--primary">+ Event</button>
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
        <div className="empty-state">
          <div className="empty-state__title">The chronicle is blank.</div>
          <p className="empty-state__body">
            Promote moments from the transcript or jot down notes and events to build out the campaign's memory.
          </p>
        </div>
      )}

      <div className="list-stack">
        {entries.map((e) => (
          <div key={e.id} className="list-card">
            <div className="list-card__header">
              <div className="list-card__meta" style={{ marginTop: 0 }}>
                <span className={`badge ${kindBadge[e.kind] || "badge--neutral"}`}>{e.kind}</span>
                {e.visibility === "dm_only" && (
                  <span className="badge badge--danger">DM only</span>
                )}
                <span className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                  {new Date(e.source_timestamp || e.created_at).toLocaleString()}
                </span>
              </div>
              <div className="list-card__actions">
                <button
                  onClick={async () => {
                    await apiFetch(`/campaigns/${campaignId}/memory/${e.id}`, { method: "DELETE" });
                    load();
                  }}
                  className="btn btn--ghost btn--sm"
                  style={{ color: "var(--danger)" }}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="list-card__body">{e.content || e.final_text}</div>
            {e.dm_annotation && (
              <div className="list-card__body" style={{ color: "var(--tome-300)", fontStyle: "italic" }}>
                DM note: {e.dm_annotation}
              </div>
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
    <form onSubmit={save} className="form-panel">
      <div className="form-panel__title">New {kind}</div>

      <div className="form-group">
        <label className="form-label">{kind === "note" ? "Note content" : "What happened?"}</label>
        <textarea
          placeholder={kind === "note" ? "Free-form note…" : "Combat outcome, key moment…"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          className="form-textarea"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Visibility</label>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="form-select"
        >
          <option value="public">Public</option>
          <option value="dm_only">DM Only</option>
        </select>
      </div>

      <div className="form-panel__actions">
        <button type="submit" disabled={saving} className="btn btn--primary">
          {saving ? "Saving…" : `Create ${kind}`}
        </button>
        <button type="button" onClick={onCancel} className="btn btn--ghost">Cancel</button>
      </div>
    </form>
  );
}
