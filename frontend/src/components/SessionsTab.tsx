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

  // Speaker mapping (Discord user ID → role/PC)
  const [speakers, setSpeakers] = useState<Speaker[]>([]);

  // Generate response modal state
  const [showGenerate, setShowGenerate] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [genCharacterId, setGenCharacterId] = useState("");
  const [genContext, setGenContext] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Per-response presence override (initialized from session-level presence)
  const [responsePresent, setResponsePresent] = useState<Set<string>>(new Set());

  // Promote to memory state
  const [showPromote, setShowPromote] = useState(false);
  const [promoteAnnotation, setPromoteAnnotation] = useState("");
  const [promoting, setPromoting] = useState(false);

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
    }
  };

  const loadSpeakers = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/speakers`);
    if (r.ok) setSpeakers(await r.json());
  };

  // Speaker label resolver: returns "Torg (Alex)" for PCs, "Alex (DM)" for DM, "Alex" for unknown
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
    // Ignore if clicking the checkbox directly
    if ((e.target as HTMLElement).tagName === "INPUT") return;

    isDragging.current = true;
    dragStartIdx.current = idx;
    dragCurrentIdx.current = idx;
    shiftHeld.current = e.shiftKey;

    // Snapshot current selection for shift-additive mode
    preSelectSnapshot.current = new Set(selected);

    // Apply initial single-item selection
    if (e.shiftKey) {
      setSelected(new Set([...selected, transcript[idx].id]));
    } else {
      setSelected(new Set([transcript[idx].id]));
    }

    e.preventDefault(); // Prevent text selection
  };

  const handleDragEnter = (idx: number) => {
    if (!isDragging.current) return;
    dragCurrentIdx.current = idx;

    const rangeIds = getRange(dragStartIdx.current, idx);
    if (shiftHeld.current) {
      // Additive: keep pre-existing selection + add the dragged range
      setSelected(new Set([...preSelectSnapshot.current, ...rangeIds]));
    } else {
      setSelected(new Set(rangeIds));
    }
  };

  const handleDragEnd = () => {
    isDragging.current = false;
  };

  // Global mouseup listener to end drag even if mouse leaves the transcript box
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

  // ── Generate Response ─────────────────────────────────────────────────
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
      // ElevenLabs failures bubble up here too — message is descriptive
      toast.show(`Finalize failed: ${detail}`, "error");
    }
    setFinalizing(false);
  };

  // ── Promote to Memory ─────────────────────────────────────────────────
  const handlePromote = async () => {
    if (selected.size === 0) return;
    setPromoting(true);
    // Build content from selected transcript lines
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
    }
    setPromoting(false);
  };

  return (
    <div>
      {/* Create session */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "15px" }}>Sessions</h3>
      </div>

      <form onSubmit={handleCreate} style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input
          placeholder="Session title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={styles.input}
        />
        <button type="submit" disabled={creating} style={styles.btn}>
          {creating ? "Creating..." : "+ New Session"}
        </button>
      </form>

      {/* Session selector */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => { setActiveSession(s); setSelected(new Set()); }}
            style={{
              ...styles.sessionBtn,
              ...(activeSession?.id === s.id ? styles.sessionBtnActive : {}),
            }}
          >
            {s.title || "Untitled"}{" "}
            <span style={{ fontSize: "10px", color: s.status === "active" ? "#4ade80" : "#666" }}>
              ({s.status})
            </span>
          </button>
        ))}
      </div>

      {/* Active session + presence panel */}
      {activeSession && (
        <div style={{ display: "flex", gap: "16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        <>
          {/* Controls */}
          <div style={styles.controlBar}>
            <span style={{ fontSize: "13px", flex: 1 }}>
              <strong>{activeSession.title || "Untitled"}</strong>
              {" — "}
              <span style={{ color: activeSession.status === "active" ? "#4ade80" : "#888" }}>
                {activeSession.status}
              </span>
              {activeSession.paused && (
                <span style={{ color: "#fbbf24", marginLeft: "8px" }}>(PAUSED)</span>
              )}
            </span>
            {activeSession.status === "active" && (
              <>
                <button onClick={handlePause} style={styles.controlBtn}>
                  {activeSession.paused ? "Resume STT" : "Pause STT"}
                </button>
                <button
                  onClick={handleEnd}
                  style={{ ...styles.controlBtn, borderColor: "#f87171", color: "#f87171" }}
                >
                  End Session
                </button>
              </>
            )}
          </div>

          {/* Transcript */}
          <div style={styles.transcriptBox}>
            {transcript.length === 0 && (
              <p style={{ color: "#555", fontStyle: "italic", padding: "16px" }}>
                {activeSession.status === "active"
                  ? "Waiting for transcript... Use /join in Discord."
                  : "No transcript entries for this session."}
              </p>
            )}
            {transcript.map((e, idx) => (
              <div
                key={e.id}
                onMouseDown={(ev) => handleDragStart(idx, ev)}
                onMouseEnter={() => handleDragEnter(idx)}
                onMouseUp={handleDragEnd}
                style={{
                  ...styles.transcriptEntry,
                  ...(selected.has(e.id) ? styles.transcriptSelected : {}),
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={() => toggleSelect(e.id)}
                    onClick={(ev) => ev.stopPropagation()}
                    style={{ accentColor: "#7c3aed" }}
                  />
                  <span style={styles.speaker}>{getSpeakerLabel(e.speaker_user_id, e.speaker_display_name)}</span>
                  <span style={styles.timestamp}>
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <p style={{ margin: "2px 0 0 24px", fontSize: "13px", lineHeight: 1.5 }}>
                  {e.text}
                </p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Selection action bar */}
          {selected.size > 0 && (
            <div style={{ ...styles.actionBar, marginTop: "8px" }}>
              <span style={{ fontSize: "12px", color: "#aaa" }}>{selected.size} selected</span>
              <button onClick={() => setShowPromote(true)} style={styles.actionBtn}>
                Promote to Memory
              </button>
              <button onClick={openGenerate} style={{ ...styles.actionBtn, background: "#c084fc" }}>
                Generate Response
              </button>
              <button onClick={() => setSelected(new Set())} style={styles.clearBtn}>
                Clear
              </button>
            </div>
          )}

          {/* Promote modal */}
          {showPromote && (
            <div style={{ ...styles.modal, marginTop: "8px" }}>
              <h4 style={{ margin: "0 0 8px", fontSize: "14px" }}>Promote to Memory</h4>
              <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#888" }}>
                {selected.size} transcript lines will be saved as a memory note.
              </p>
              <textarea
                placeholder="DM annotation (optional)"
                value={promoteAnnotation}
                onChange={(e) => setPromoteAnnotation(e.target.value)}
                style={styles.textarea}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button onClick={handlePromote} disabled={promoting} style={styles.btn}>
                  {promoting ? "Saving..." : "Save Note"}
                </button>
                <button onClick={() => setShowPromote(false)} style={styles.clearBtn}>Cancel</button>
              </div>
            </div>
          )}

          {/* Generate response modal */}
          {showGenerate && (
            <div style={{ ...styles.modal, marginTop: "8px" }}>
              <h4 style={{ margin: "0 0 8px", fontSize: "14px" }}>Generate NPC Response</h4>
              <select
                value={genCharacterId}
                onChange={(e) => setGenCharacterId(e.target.value)}
                style={styles.input}
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.elevenlabs_voice_id ? "(has voice)" : "(no voice)"}
                  </option>
                ))}
              </select>
              <textarea
                placeholder="Additional context for the AI (optional)"
                value={genContext}
                onChange={(e) => setGenContext(e.target.value)}
                style={{ ...styles.textarea, marginTop: "8px" }}
              />

              {/* Per-response presence override */}
              {characters.filter((c) => presentCharIds.has(c.id)).length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#888" }}>NPCs who hear this exchange:</span>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                    {characters
                      .filter((c) => presentCharIds.has(c.id))
                      .map((c) => (
                        <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#ccc", cursor: "pointer" }}>
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
                            style={{ accentColor: "#7c3aed" }}
                          />
                          {c.name}
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {!generatedText ? (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <button onClick={handleGenerate} disabled={generating || !genCharacterId} style={styles.btn}>
                    {generating ? "Generating..." : "Generate"}
                  </button>
                  <button onClick={() => setShowGenerate(false)} style={styles.clearBtn}>Cancel</button>
                </div>
              ) : (
                <>
                  <textarea
                    value={generatedText}
                    onChange={(e) => setGeneratedText(e.target.value)}
                    style={{ ...styles.textarea, marginTop: "8px", minHeight: "100px", color: "#c084fc" }}
                  />
                  <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#666" }}>
                    Edit the text above if needed, then generate audio.
                  </p>
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <button onClick={handleGenerate} disabled={generating} style={styles.clearBtn}>
                      {generating ? "Regenerating..." : "Regenerate"}
                    </button>
                    <button onClick={handleFinalize} disabled={finalizing} style={{ ...styles.btn, background: "#4ade80", color: "#000" }}>
                      {finalizing ? "Finalizing..." : "Generate Audio & Save"}
                    </button>
                    <button onClick={() => setShowGenerate(false)} style={styles.clearBtn}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
        </div>

        {/* Character presence panel */}
        <div style={styles.presencePanel}>
          <h4 style={{ margin: "0 0 12px", fontSize: "13px", color: "#aaa" }}>Present NPCs</h4>
          {characters.length === 0 && (
            <p style={{ color: "#555", fontSize: "12px", fontStyle: "italic" }}>No characters yet.</p>
          )}
          {characters.map((c) => (
            <label key={c.id} style={styles.presenceRow}>
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
                style={{ accentColor: "#7c3aed" }}
              />
              <span style={{ fontSize: "13px" }}>{c.name}</span>
              {!c.elevenlabs_voice_id && (
                <span style={{ fontSize: "10px", color: "#555", marginLeft: "auto" }}>no voice</span>
              )}
            </label>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  input: {
    flex: 1, padding: "8px 12px", borderRadius: "6px", border: "1px solid #333",
    background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none",
  },
  textarea: {
    width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #333",
    background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none",
    minHeight: "60px", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const,
  },
  btn: {
    padding: "8px 16px", borderRadius: "6px", border: "none", background: "#7c3aed",
    color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  sessionBtn: {
    padding: "6px 12px", borderRadius: "6px", border: "1px solid #333",
    background: "#1a1a1a", color: "#888", fontSize: "12px", cursor: "pointer",
  },
  sessionBtnActive: { border: "1px solid #7c3aed", color: "#e0e0e0" },
  controlBar: {
    display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px",
    padding: "12px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #2a2a2a",
  },
  controlBtn: {
    padding: "6px 14px", borderRadius: "6px", border: "1px solid #555",
    background: "none", color: "#e0e0e0", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap",
  },
  actionBar: {
    display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px",
    padding: "8px 12px", background: "#1a1a2a", borderRadius: "8px", border: "1px solid #333",
  },
  actionBtn: {
    padding: "6px 12px", borderRadius: "6px", border: "none", background: "#7c3aed",
    color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer",
  },
  clearBtn: {
    padding: "6px 12px", borderRadius: "6px", border: "1px solid #444",
    background: "none", color: "#888", fontSize: "12px", cursor: "pointer",
  },
  modal: {
    padding: "16px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #444",
    marginBottom: "12px",
  },
  transcriptBox: {
    background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: "8px",
    maxHeight: "500px", overflowY: "auto",
  },
  transcriptEntry: {
    padding: "8px 16px", borderBottom: "1px solid #1a1a1a",
  },
  transcriptSelected: {
    background: "#1a1a2e", borderLeft: "3px solid #7c3aed",
  },
  speaker: { color: "#7dd3fc", fontWeight: 600, marginRight: "8px", fontSize: "13px" },
  timestamp: { color: "#555", fontSize: "11px" },
  presencePanel: {
    width: "180px", flexShrink: 0, padding: "12px",
    background: "#1a1a1a", borderRadius: "8px", border: "1px solid #2a2a2a",
    alignSelf: "flex-start", position: "sticky" as const, top: "16px",
  },
  presenceRow: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "6px 0", cursor: "pointer", color: "#e0e0e0",
  },
};
