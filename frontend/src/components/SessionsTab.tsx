import { useEffect, useState, useRef } from "react";
import { apiFetch, supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";

interface Session {
  id: string;
  title: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  paused: boolean;
}

interface TranscriptEntry {
  id: string;
  speaker_user_id: string;
  speaker_display_name: string;
  text: string;
  created_at: string;
}

interface Speaker {
  id: string;
  discord_user_id: string;
  discord_display_name: string;
  role: string;
  character_id: string | null;
  character_name: string | null;
}

interface Character {
  id: string;
  name: string;
  elevenlabs_voice_id: string | null;
}

export default function SessionsTab({ campaignId }: { campaignId: string }) {
  const toast = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Drag-to-select state
  const isDragging = useRef(false);
  const dragStartIdx = useRef<number>(-1);
  const dragCurrentIdx = useRef<number>(-1);
  const preSelectSnapshot = useRef<Set<string>>(new Set());
  const shiftHeld = useRef(false);

  // Character presence state
  const [presentCharIds, setPresentCharIds] = useState<Set<string>>(new Set());

  // Speaker mapping
  const [speakers, setSpeakers] = useState<Speaker[]>([]);

  // Generate response modal state
  const [showGenerate, setShowGenerate] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [genCharacterId, setGenCharacterId] = useState("");
  const [genContext, setGenContext] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Per-response presence override
  const [responsePresent, setResponsePresent] = useState<Set<string>>(new Set());

  // Promote to memory state
  const [showPromote, setShowPromote] = useState(false);
  const [promoteAnnotation, setPromoteAnnotation] = useState("");
  const [promoting, setPromoting] = useState(false);

  // Speak as NPC (DM-authored, no Claude) state
  const [showSpeak, setShowSpeak] = useState(false);
  const [speakCharacterId, setSpeakCharacterId] = useState("");
  const [speakText, setSpeakText] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const loadSessions = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/sessions`);
    if (r.ok) {
      const data = await r.json();
      setSessions(data);
      const active = data.find((s: Session) => s.status === "active");
      if (active && !activeSession) setActiveSession(active);
    }
  };

  const loadTranscript = async (sessionId: string) => {
    const r = await apiFetch(
      `/campaigns/${campaignId}/sessions/${sessionId}/transcript`
    );
    if (r.ok) setTranscript(await r.json());
  };

  const loadCharacters = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/characters?kind=npc`);
    if (r.ok) {
      const data = await r.json();
      setCharacters(data);
      if (data.length > 0 && !genCharacterId) setGenCharacterId(data[0].id);
      if (data.length > 0 && !speakCharacterId) setSpeakCharacterId(data[0].id);
    }
  };

  const loadSpeakers = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/speakers`);
    if (r.ok) setSpeakers(await r.json());
  };

  const getSpeakerLabel = (userId: string, displayName: string): string => {
    const s = speakers.find((sp) => sp.discord_user_id === userId);
    if (!s) return displayName;
    if (s.role === "dm") return `${displayName} (DM)`;
    if (s.character_name) return `${s.character_name} (${displayName})`;
    return displayName;
  };

  useEffect(() => {
    loadSessions();
    loadCharacters();
    loadSpeakers();
  }, [campaignId]);

  useEffect(() => {
    if (activeSession) loadTranscript(activeSession.id);
  }, [activeSession?.id]);

  // Supabase Realtime
  useEffect(() => {
    if (!activeSession || activeSession.status !== "active") return;
    const channel = supabase
      .channel(`transcript:${activeSession.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transcript_entries",
          filter: `session_id=eq.${activeSession.id}`,
        },
        (payload) => {
          const entry = payload.new as TranscriptEntry;
          setTranscript((prev) => {
            if (prev.some((e) => e.id === entry.id)) return prev;
            return [...prev, entry];
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSession?.id, activeSession?.status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Drag-to-select helpers ──────────────────────────────────────────
  const getRange = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return transcript.slice(lo, hi + 1).map((e) => e.id);
  };

  const handleDragStart = (idx: number, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;

    isDragging.current = true;
    dragStartIdx.current = idx;
    dragCurrentIdx.current = idx;
    shiftHeld.current = e.shiftKey;
    preSelectSnapshot.current = new Set(selected);

    if (e.shiftKey) {
      setSelected(new Set([...selected, transcript[idx].id]));
    } else {
      setSelected(new Set([transcript[idx].id]));
    }

    e.preventDefault();
  };

  const handleDragEnter = (idx: number) => {
    if (!isDragging.current) return;
    dragCurrentIdx.current = idx;

    const rangeIds = getRange(dragStartIdx.current, idx);
    if (shiftHeld.current) {
      setSelected(new Set([...preSelectSnapshot.current, ...rangeIds]));
    } else {
      setSelected(new Set(rangeIds));
    }
  };

  const handleDragEnd = () => {
    isDragging.current = false;
  };

  useEffect(() => {
    const onMouseUp = () => { isDragging.current = false; };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const r = await apiFetch(`/campaigns/${campaignId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ title: title.trim() || null }),
    });
    if (r.ok) {
      const session = await r.json();
      setTitle("");
      await loadSessions();
      setActiveSession(session);
    }
    setCreating(false);
  };

  const handleEnd = async () => {
    if (!activeSession) return;
    const r = await apiFetch(
      `/campaigns/${campaignId}/sessions/${activeSession.id}/end`,
      { method: "POST" }
    );
    if (r.ok) { setActiveSession(await r.json()); loadSessions(); }
  };

  const handlePause = async () => {
    if (!activeSession) return;
    const endpoint = activeSession.paused ? "resume" : "pause";
    const r = await apiFetch(
      `/campaigns/${campaignId}/sessions/${activeSession.id}/${endpoint}`,
      { method: "POST" }
    );
    if (r.ok) setActiveSession(await r.json());
  };

  const openGenerate = () => {
    if (selected.size === 0) return;
    setGeneratedText("");
    setResponsePresent(new Set(presentCharIds));
    setGenContext("");
    setShowGenerate(true);
  };

  const handleGenerate = async () => {
    if (!genCharacterId) return;
    setGenerating(true);
    const r = await apiFetch(`/campaigns/${campaignId}/memory/generate-response`, {
      method: "POST",
      body: JSON.stringify({
        selected_transcript_ids: [...selected],
        character_id: genCharacterId,
        additional_context: genContext || null,
      }),
    });
    if (r.ok) {
      const data = await r.json();
      setGeneratedText(data.generated_text);
      toast.show("Response generated", "success");
    } else {
      const err = await r.json().catch(() => ({}));
      const detail = err.detail || `HTTP ${r.status}`;
      toast.show(`Claude generation failed: ${detail}`, "error");
    }
    setGenerating(false);
  };

  const handleFinalize = async () => {
    if (!generatedText.trim()) return;
    setFinalizing(true);
    const r = await apiFetch(`/campaigns/${campaignId}/memory/finalize-response`, {
      method: "POST",
      body: JSON.stringify({
        selected_transcript_ids: [...selected],
        character_id: genCharacterId,
        additional_context: genContext || null,
        final_text: generatedText,
        session_id: activeSession?.id || null,
        present_character_ids: [...responsePresent],
      }),
    });
    if (r.ok) {
      const data = await r.json();
      setShowGenerate(false);
      setSelected(new Set());
      setGeneratedText("");
      if (data.tts_error) {
        toast.show(`Saved to memory, but TTS failed: ${data.tts_error}`, "error");
      } else {
        toast.show("Response saved to memory and audio queue", "success");
      }
    } else {
      const err = await r.json().catch(() => ({}));
      const detail = err.detail || `HTTP ${r.status}`;
      toast.show(`Finalize failed: ${detail}`, "error");
    }
    setFinalizing(false);
  };

  // ── Speak as NPC ──────────────────────────────────────────────────────
  // DM-authored line: skips Claude entirely, sends typed text straight to
  // ElevenLabs and queues the audio. Backend auto-prepends the character's
  // direction tag the same way it does for generated responses.
  const openSpeak = () => {
    setSpeakText("");
    setShowSpeak(true);
  };

  const handleSpeak = async () => {
    if (!speakCharacterId || !speakText.trim()) return;
    setSpeaking(true);
    const r = await apiFetch(`/campaigns/${campaignId}/memory/finalize-response`, {
      method: "POST",
      body: JSON.stringify({
        selected_transcript_ids: [],
        character_id: speakCharacterId,
        additional_context: null,
        final_text: speakText.trim(),
        session_id: activeSession?.id || null,
        present_character_ids: [],
      }),
    });
    if (r.ok) {
      const data = await r.json();
      setShowSpeak(false);
      setSpeakText("");
      if (data.tts_error) {
        toast.show(`Saved to memory, but TTS failed: ${data.tts_error}`, "error");
      } else {
        toast.show("Line queued for playback", "success");
      }
    } else {
      const err = await r.json().catch(() => ({}));
      toast.show(`Speak failed: ${err.detail || `HTTP ${r.status}`}`, "error");
    }
    setSpeaking(false);
  };

  const handlePromote = async () => {
    if (selected.size === 0) return;
    setPromoting(true);
    const selectedLines = transcript
      .filter((e) => selected.has(e.id))
      .map((e) => `${e.speaker_display_name}: ${e.text}`)
      .join("\n");

    const r = await apiFetch(`/campaigns/${campaignId}/memory/note`, {
      method: "POST",
      body: JSON.stringify({
        session_id: activeSession?.id || null,
        content: selectedLines,
        selected_transcript_ids: [...selected],
        dm_annotation: promoteAnnotation || null,
      }),
    });
    if (r.ok) {
      setShowPromote(false);
      setSelected(new Set());
      setPromoteAnnotation("");
      toast.show("Promoted to memory", "success");
    }
    setPromoting(false);
  };

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-header__title">Sessions</h2>
      </div>

      <form onSubmit={handleCreate} className="form-row" style={{ marginBottom: "var(--space-5)" }}>
        <input
          placeholder="Session title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="form-input"
        />
        <button type="submit" disabled={creating} className="btn btn--primary">
          {creating ? "Creating…" : "+ New Session"}
        </button>
      </form>

      {sessions.length > 0 && (
        <div className="session-pill-row">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setActiveSession(s); setSelected(new Set()); }}
              className={`session-pill${activeSession?.id === s.id ? " active" : ""}`}
            >
              {s.title || "Untitled"}
              <span
                className={`session-pill__status${s.status === "active" ? " session-pill__status--active" : ""}`}
              >
                {s.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {activeSession && (
        <div className="session-layout">
          <div style={{ minWidth: 0 }}>
            <div className="session-bar">
              <div className="session-bar__title">
                <strong>{activeSession.title || "Untitled"}</strong>
                <span
                  className={`status-dot status-dot--${
                    activeSession.paused ? "paused" : activeSession.status === "active" ? "active" : "ended"
                  }`}
                >
                  {activeSession.paused ? "paused" : activeSession.status}
                </span>
              </div>
              {activeSession.status === "active" && (
                <>
                  <button onClick={openSpeak} className="btn btn--gold btn--sm">
                    Speak as NPC
                  </button>
                  <button onClick={handlePause} className="btn btn--secondary btn--sm">
                    {activeSession.paused ? "Resume STT" : "Pause STT"}
                  </button>
                  <button
                    onClick={handleEnd}
                    className="btn btn--secondary btn--sm"
                    style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                  >
                    End Session
                  </button>
                </>
              )}
            </div>

            <div className="transcript-box">
              {transcript.length === 0 ? (
                <div className="transcript-empty">
                  {activeSession.status === "active"
                    ? "Waiting for transcript… Use /join in Discord."
                    : "No transcript entries for this session."}
                </div>
              ) : (
                transcript.map((e, idx) => (
                  <div
                    key={e.id}
                    onMouseDown={(ev) => handleDragStart(idx, ev)}
                    onMouseEnter={() => handleDragEnter(idx)}
                    onMouseUp={handleDragEnd}
                    className={`transcript-row${selected.has(e.id) ? " selected" : ""}`}
                  >
                    <div className="transcript-row__head">
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggleSelect(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="checkbox"
                      />
                      <span className="transcript-row__speaker">
                        {getSpeakerLabel(e.speaker_user_id, e.speaker_display_name)}
                      </span>
                      <span className="transcript-row__time">
                        {new Date(e.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="transcript-row__body">{e.text}</p>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {selected.size > 0 && (
              <div className="action-bar">
                <span className="action-bar__count">{selected.size} selected</span>
                <button onClick={() => setShowPromote(true)} className="btn btn--secondary btn--sm">
                  Promote to Memory
                </button>
                <button onClick={openGenerate} className="btn btn--primary btn--sm">
                  Generate Response
                </button>
                <button onClick={() => setSelected(new Set())} className="btn btn--ghost btn--sm">
                  Clear
                </button>
              </div>
            )}

            {showPromote && (
              <div className="inline-panel">
                <div className="inline-panel__title">Promote to Memory</div>
                <div className="inline-panel__hint">
                  {selected.size} transcript lines will be saved as a memory note.
                </div>
                <div className="form-group">
                  <label className="form-label">DM annotation (optional)</label>
                  <textarea
                    value={promoteAnnotation}
                    onChange={(e) => setPromoteAnnotation(e.target.value)}
                    className="form-textarea"
                  />
                </div>
                <div className="form-panel__actions">
                  <button onClick={handlePromote} disabled={promoting} className="btn btn--primary">
                    {promoting ? "Saving…" : "Save Note"}
                  </button>
                  <button onClick={() => setShowPromote(false)} className="btn btn--ghost">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {showGenerate && (
              <div className="inline-panel">
                <div className="inline-panel__title">Generate NPC Response</div>

                <div className="form-group">
                  <label className="form-label">Character</label>
                  <select
                    value={genCharacterId}
                    onChange={(e) => setGenCharacterId(e.target.value)}
                    className="form-select"
                    style={{ width: "100%" }}
                  >
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.elevenlabs_voice_id ? "(has voice)" : "(no voice)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Additional context (optional)</label>
                  <textarea
                    value={genContext}
                    onChange={(e) => setGenContext(e.target.value)}
                    className="form-textarea"
                  />
                </div>

                {characters.filter((c) => presentCharIds.has(c.id)).length > 0 && (
                  <div className="form-group">
                    <label className="form-label">NPCs who hear this exchange</label>
                    <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
                      {characters
                        .filter((c) => presentCharIds.has(c.id))
                        .map((c) => (
                          <label key={c.id} className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={responsePresent.has(c.id)}
                              onChange={() => {
                                setResponsePresent((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(c.id)) next.delete(c.id);
                                  else next.add(c.id);
                                  return next;
                                });
                              }}
                              className="checkbox"
                            />
                            {c.name}
                          </label>
                        ))}
                    </div>
                  </div>
                )}

                {!generatedText ? (
                  <div className="form-panel__actions">
                    <button
                      onClick={handleGenerate}
                      disabled={generating || !genCharacterId}
                      className="btn btn--primary"
                    >
                      {generating ? "Generating…" : "Generate"}
                    </button>
                    <button onClick={() => setShowGenerate(false)} className="btn btn--ghost">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="form-group">
                      <label className="form-label">Generated text (editable)</label>
                      <textarea
                        value={generatedText}
                        onChange={(e) => setGeneratedText(e.target.value)}
                        className="form-textarea"
                        style={{ minHeight: 140, color: "var(--violet-200)" }}
                      />
                      <p className="form-helper">Edit the text above if needed, then generate audio.</p>
                    </div>
                    <div className="form-panel__actions">
                      <button onClick={handleGenerate} disabled={generating} className="btn btn--secondary">
                        {generating ? "Regenerating…" : "Regenerate"}
                      </button>
                      <button
                        onClick={handleFinalize}
                        disabled={finalizing}
                        className="btn btn--gold"
                      >
                        {finalizing ? "Finalizing…" : "Generate Audio & Save"}
                      </button>
                      <button onClick={() => setShowGenerate(false)} className="btn btn--ghost">
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {showSpeak && (
              <div className="inline-panel">
                <div className="inline-panel__title">Speak as NPC</div>
                <div className="inline-panel__hint">
                  Type the line yourself — skips Claude entirely. The character's
                  voice direction will be auto-applied by ElevenLabs.
                </div>

                <div className="form-group">
                  <label className="form-label">Character</label>
                  <select
                    value={speakCharacterId}
                    onChange={(e) => setSpeakCharacterId(e.target.value)}
                    className="form-select"
                    style={{ width: "100%" }}
                  >
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.elevenlabs_voice_id ? "(has voice)" : "(no voice)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Line</label>
                  <textarea
                    value={speakText}
                    onChange={(e) => setSpeakText(e.target.value)}
                    placeholder="What does the NPC say?"
                    className="form-textarea"
                    style={{ minHeight: 120 }}
                    autoFocus
                  />
                </div>

                <div className="form-panel__actions">
                  <button
                    onClick={handleSpeak}
                    disabled={speaking || !speakCharacterId || !speakText.trim()}
                    className="btn btn--gold"
                  >
                    {speaking ? "Sending…" : "Generate Audio & Save"}
                  </button>
                  <button
                    onClick={() => setShowSpeak(false)}
                    className="btn btn--ghost"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="presence-panel">
            <div className="presence-panel__title">Present NPCs</div>
            {characters.length === 0 && (
              <p className="muted--italic" style={{ fontSize: 13 }}>No characters yet.</p>
            )}
            {characters.map((c) => (
              <label key={c.id} className="presence-row">
                <input
                  type="checkbox"
                  checked={presentCharIds.has(c.id)}
                  onChange={() => {
                    setPresentCharIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                  className="checkbox"
                />
                <span>{c.name}</span>
                {!c.elevenlabs_voice_id && (
                  <span className="presence-row__voice">no voice</span>
                )}
              </label>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
