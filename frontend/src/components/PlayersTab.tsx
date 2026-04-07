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

  const updateSpeaker = async (speakerId: string, body: { role?: string; character_id?: string | null }) => {
    await apiFetch(`/campaigns/${campaignId}/speakers/${speakerId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "15px" }}>Players</h3>
        <button onClick={() => setShowCreatePc(true)} style={styles.btn}>
          + New Player Character
        </button>
      </div>

      {showCreatePc && (
        <PcForm
          campaignId={campaignId}
          onDone={() => { setShowCreatePc(false); load(); }}
          onCancel={() => setShowCreatePc(false)}
        />
      )}

      {/* Player Characters list */}
      <h4 style={{ margin: "16px 0 8px", fontSize: "13px", color: "#aaa" }}>
        Player Characters ({pcs.length})
      </h4>
      {pcs.length === 0 && (
        <p style={{ color: "#555", fontSize: "12px", fontStyle: "italic" }}>
          No player characters yet.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "24px" }}>
        {pcs.map((pc) => (
          <div key={pc.id} style={styles.card}>
            <strong>{pc.name}</strong>
          </div>
        ))}
      </div>

      {/* Discord speakers */}
      <h4 style={{ margin: "16px 0 8px", fontSize: "13px", color: "#aaa" }}>
        Discord Speakers
      </h4>
      <p style={{ color: "#555", fontSize: "12px", fontStyle: "italic", marginBottom: "8px" }}>
        Speakers are auto-detected when they speak in a session. Assign each speaker to a role.
      </p>
      {speakers.length === 0 && (
        <p style={{ color: "#555", fontSize: "12px", fontStyle: "italic" }}>
          No speakers detected yet. Start a session and have someone speak.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {speakers.map((s) => (
          <div key={s.id} style={styles.speakerRow}>
            <div style={{ flex: 1 }}>
              <strong>{s.discord_display_name}</strong>
              <span style={{ color: "#555", fontSize: "11px", marginLeft: "8px" }}>
                {s.discord_user_id}
              </span>
            </div>
            <select
              value={s.role}
              onChange={(e) => updateSpeaker(s.id, { role: e.target.value })}
              style={styles.select}
            >
              <option value="unknown">Unknown</option>
              <option value="dm">DM</option>
              <option value="player">Player</option>
            </select>
            {s.role === "player" && (
              <select
                value={s.character_id || ""}
                onChange={(e) => updateSpeaker(s.id, { character_id: e.target.value || null })}
                style={styles.select}
              >
                <option value="">— No PC —</option>
                {pcs.map((pc) => (
                  <option key={pc.id} value={pc.id}>{pc.name}</option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
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
    <form onSubmit={save} style={styles.form}>
      <input placeholder="PC Name *" value={name} onChange={(e) => setName(e.target.value)} required style={styles.input} />
      <textarea placeholder="Description (race, class, background)" value={description} onChange={(e) => setDescription(e.target.value)} style={styles.textarea} />
      <textarea placeholder="Personality" value={personality} onChange={(e) => setPersonality(e.target.value)} style={styles.textarea} />
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" disabled={saving} style={styles.btn}>
          {saving ? "Saving..." : "Create"}
        </button>
        <button type="button" onClick={onCancel} style={styles.smallBtn}>Cancel</button>
      </div>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { padding: "10px 14px", background: "#1a1a1a", borderRadius: "6px", border: "1px solid #2a2a2a" },
  speakerRow: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "10px 14px", background: "#1a1a1a", borderRadius: "6px",
    border: "1px solid #2a2a2a",
  },
  select: {
    padding: "6px 10px", borderRadius: "6px", border: "1px solid #333",
    background: "#0f0f0f", color: "#e0e0e0", fontSize: "12px", outline: "none",
  },
  btn: {
    padding: "8px 16px", borderRadius: "6px", border: "none",
    background: "#7c3aed", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer",
  },
  smallBtn: {
    background: "none", border: "1px solid #333", color: "#888",
    padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
  },
  form: {
    display: "flex", flexDirection: "column", gap: "8px",
    padding: "16px", background: "#1a1a1a", borderRadius: "8px",
    border: "1px solid #2a2a2a", marginBottom: "12px",
  },
  input: {
    padding: "8px 12px", borderRadius: "6px", border: "1px solid #333",
    background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none",
  },
  textarea: {
    padding: "8px 12px", borderRadius: "6px", border: "1px solid #333",
    background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none",
    minHeight: "60px", resize: "vertical" as const, fontFamily: "inherit",
  },
};
