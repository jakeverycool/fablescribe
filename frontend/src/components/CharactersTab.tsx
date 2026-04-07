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
      <div className="tab-header">
        <h2 className="tab-header__title">Characters</h2>
        <div className="tab-header__actions">
          <button onClick={() => setShowCreate(true)} className="btn btn--primary">
            + New Character
          </button>
        </div>
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
        <div className="empty-state">
          <div className="empty-state__title">No characters yet.</div>
          <p className="empty-state__body">
            Create NPCs the party will meet — give each one a voice, a personality, and a secret or two.
          </p>
        </div>
      )}

      <div className="list-stack">
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
            <div key={c.id} className="list-card">
              <div className="list-card__header">
                <div>
                  <div className="list-card__title">{c.name}</div>
                  {c.elevenlabs_voice_id && (
                    <div className="list-card__meta">
                      <span className="badge badge--neutral">
                        Voice: {voices.find((v) => v.id === c.elevenlabs_voice_id)?.name || c.elevenlabs_voice_id}
                      </span>
                    </div>
                  )}
                </div>
                <div className="list-card__actions">
                  <button onClick={() => setEditing(c.id)} className="btn btn--secondary btn--sm">
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await apiFetch(`/campaigns/${campaignId}/characters/${c.id}`, { method: "DELETE" });
                      load();
                    }}
                    className="btn btn--ghost btn--sm"
                    style={{ color: "var(--danger)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {c.description && <div className="list-card__body">{c.description}</div>}
              {c.personality && (
                <div className="list-card__body" style={{ color: "var(--violet-200)" }}>
                  <em>Personality:</em> {c.personality}
                </div>
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
    <form onSubmit={handleSubmit} className="form-panel">
      <div className="form-panel__title">{initial ? "Edit character" : "New character"}</div>

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

      <div className="form-group">
        <label className="form-label">Speech notes</label>
        <textarea
          placeholder="Accent, cadence, verbal tics…"
          value={speechNotes}
          onChange={(e) => setSpeechNotes(e.target.value)}
          className="form-textarea"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Secrets <span style={{ color: "var(--tome-400)" }}>(DM-only)</span></label>
        <textarea
          value={secrets}
          onChange={(e) => setSecrets(e.target.value)}
          className="form-textarea"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Voice</label>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="form-select"
            style={{ flex: 1 }}
          >
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
                  if (audioRef.current) audioRef.current.pause();
                  audioRef.current = new Audio(voice.preview_url);
                  audioRef.current.play();
                }}
                className="btn btn--secondary btn--sm"
              >
                Preview
              </button>
            ) : null;
          })()}
        </div>
      </div>

      <div className="form-panel__actions">
        <button type="submit" disabled={saving} className="btn btn--primary">
          {saving ? "Saving…" : initial ? "Update" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn--ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
