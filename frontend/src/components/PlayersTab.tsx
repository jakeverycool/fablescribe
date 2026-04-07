import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

interface Speaker {
  id: string;
  discord_user_id: string;
  discord_display_name: string;
  role: string; // 'dm' | 'player' | 'unknown'
  character_id: string | null;
  character_name: string | null;
}

interface Character {
  id: string;
  name: string;
  kind: string;
}

export default function PlayersTab({ campaignId }: { campaignId: string }) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [pcs, setPcs] = useState<Character[]>([]);
  const [showCreatePc, setShowCreatePc] = useState(false);

  const load = async () => {
    const [speakersResp, charsResp] = await Promise.all([
      apiFetch(`/campaigns/${campaignId}/speakers`),
      apiFetch(`/campaigns/${campaignId}/characters?kind=pc`),
    ]);
    if (speakersResp.ok) setSpeakers(await speakersResp.json());
    if (charsResp.ok) setPcs(await charsResp.json());
  };

  useEffect(() => {
    load();
  }, [campaignId]);

  const updateSpeaker = async (
    speakerId: string,
    body: { role?: string; character_id?: string | null },
  ) => {
    await apiFetch(`/campaigns/${campaignId}/speakers/${speakerId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    load();
  };

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-header__title">Players</h2>
        <div className="tab-header__actions">
          <button onClick={() => setShowCreatePc(true)} className="btn btn--primary">
            + New Player Character
          </button>
        </div>
      </div>

      {showCreatePc && (
        <PcForm
          campaignId={campaignId}
          onDone={() => { setShowCreatePc(false); load(); }}
          onCancel={() => setShowCreatePc(false)}
        />
      )}

      <h3 className="subhead subhead--first">
        Player Characters ({pcs.length})
      </h3>
      {pcs.length === 0 ? (
        <p className="muted--italic">No player characters yet.</p>
      ) : (
        <div className="list-stack">
          {pcs.map((pc) => (
            <div key={pc.id} className="list-card">
              <div className="list-card__title">{pc.name}</div>
            </div>
          ))}
        </div>
      )}

      <h3 className="subhead">Discord Speakers</h3>
      <p className="muted" style={{ marginBottom: "var(--space-3)" }}>
        Speakers are auto-detected when they speak in a session. Assign each speaker to a role.
      </p>
      {speakers.length === 0 ? (
        <p className="muted--italic">No speakers detected yet. Start a session and have someone speak.</p>
      ) : (
        <div className="list-stack">
          {speakers.map((s) => (
            <div key={s.id} className="list-card">
              <div className="list-card__header" style={{ alignItems: "center" }}>
                <div>
                  <div className="list-card__title" style={{ fontSize: 18 }}>{s.discord_display_name}</div>
                  <div className="list-card__meta">
                    <code>{s.discord_user_id}</code>
                  </div>
                </div>
                <div className="list-card__actions">
                  <select
                    value={s.role}
                    onChange={(e) => updateSpeaker(s.id, { role: e.target.value })}
                    className="form-select"
                  >
                    <option value="unknown">Unknown</option>
                    <option value="dm">DM</option>
                    <option value="player">Player</option>
                  </select>
                  {s.role === "player" && (
                    <select
                      value={s.character_id || ""}
                      onChange={(e) => updateSpeaker(s.id, { character_id: e.target.value || null })}
                      className="form-select"
                    >
                      <option value="">— No PC —</option>
                      {pcs.map((pc) => (
                        <option key={pc.id} value={pc.id}>{pc.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PcForm({
  campaignId, onDone, onCancel,
}: { campaignId: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [personality, setPersonality] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await apiFetch(`/campaigns/${campaignId}/characters`, {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        kind: "pc",
        description: description || null,
        personality: personality || null,
      }),
    });
    setSaving(false);
    onDone();
  };

  return (
    <form onSubmit={save} className="form-panel">
      <div className="form-panel__title">New player character</div>
      <div className="form-group">
        <label className="form-label">Name *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="form-input"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea
          placeholder="Race, class, background…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="form-textarea"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Personality</label>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          className="form-textarea"
        />
      </div>
      <div className="form-panel__actions">
        <button type="submit" disabled={saving} className="btn btn--primary">
          {saving ? "Saving…" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn--ghost">Cancel</button>
      </div>
    </form>
  );
}
