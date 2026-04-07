import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";

interface Character {
  id: string;
  name: string;
  description: string | null;
  personality: string | null;
  speech_notes: string | null;
  elevenlabs_voice_id: string | null;
  secrets: string | null;
  linked_glossary_ids: string[];
}

interface VoiceOption {
  id: string;
  name: string;
  preview_url: string;
}

export default function CharactersTab({ campaignId }: { campaignId: string }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/characters?kind=npc`);
    if (r.ok) setCharacters(await r.json());
  };

  const loadVoices = async () => {
    const r = await apiFetch("/voices");
    if (r.ok) setVoices(await r.json());
  };

  useEffect(() => {
    load();
    loadVoices();
  }, [campaignId]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "15px" }}>Characters</h3>
        <button onClick={() => setShowCreate(true)} style={styles.btn}>
          + New Character
        </button>
      </div>

      {showCreate && (
        <CharacterForm
          campaignId={campaignId}
          voices={voices}
          onDone={() => {
            setShowCreate(false);
            load();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {characters.length === 0 && !showCreate && (
        <p style={{ color: "#555", fontStyle: "italic" }}>No characters yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {characters.map((c) =>
          editing === c.id ? (
            <CharacterForm
              key={c.id}
              campaignId={campaignId}
              voices={voices}
              initial={c}
              onDone={() => {
                setEditing(null);
                load();
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={c.id} style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <strong>{c.name}</strong>
                  {c.elevenlabs_voice_id && (
                    <span style={{ color: "#888", fontSize: "12px", marginLeft: "8px" }}>
                      Voice: {voices.find((v) => v.id === c.elevenlabs_voice_id)?.name || c.elevenlabs_voice_id}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setEditing(c.id)} style={styles.smallBtn}>
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await apiFetch(`/campaigns/${campaignId}/characters/${c.id}`, { method: "DELETE" });
                      load();
                    }}
                    style={{ ...styles.smallBtn, color: "#f87171" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {c.description && <p style={styles.desc}>{c.description}</p>}
              {c.personality && (
                <p style={{ ...styles.desc, color: "#7dd3fc" }}>
                  Personality: {c.personality}
                </p>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CharacterForm({
  campaignId,
  voices,
  initial,
  onDone,
  onCancel,
}: {
  campaignId: string;
  voices: VoiceOption[];
  initial?: Character;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [personality, setPersonality] = useState(initial?.personality || "");
  const [speechNotes, setSpeechNotes] = useState(initial?.speech_notes || "");
  const [secrets, setSecrets] = useState(initial?.secrets || "");
  const [voiceId, setVoiceId] = useState(initial?.elevenlabs_voice_id || "");
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const body = {
      name,
      description: description || null,
      personality: personality || null,
      speech_notes: speechNotes || null,
      secrets: secrets || null,
      elevenlabs_voice_id: voiceId || null,
    };

    if (initial) {
      await apiFetch(`/campaigns/${campaignId}/characters/${initial.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } else {
      await apiFetch(`/campaigns/${campaignId}/characters`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    setSaving(false);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} required style={styles.input} />
      <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={styles.textarea} />
      <textarea placeholder="Personality" value={personality} onChange={(e) => setPersonality(e.target.value)} style={styles.textarea} />
      <textarea placeholder="Speech notes (accent, cadence, verbal tics)" value={speechNotes} onChange={(e) => setSpeechNotes(e.target.value)} style={styles.textarea} />
      <textarea placeholder="Secrets (DM-only)" value={secrets} onChange={(e) => setSecrets(e.target.value)} style={styles.textarea} />
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} style={{ ...styles.input, flex: 1 }}>
          <option value="">No voice assigned</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        {voiceId && (() => {
          const voice = voices.find((v) => v.id === voiceId);
          return voice?.preview_url ? (
            <button
              type="button"
              onClick={() => {
                if (audioRef.current) { audioRef.current.pause(); }
                audioRef.current = new Audio(voice.preview_url);
                audioRef.current.play();
              }}
              style={styles.smallBtn}
            >
              Preview
            </button>
          ) : null;
        })()}
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" disabled={saving} style={styles.btn}>
          {saving ? "Saving..." : initial ? "Update" : "Create"}
        </button>
        <button type="button" onClick={onCancel} style={styles.smallBtn}>
          Cancel
        </button>
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
