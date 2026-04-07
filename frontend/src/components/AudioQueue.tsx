import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

interface QueueEntry {
  id: string;
  final_text: string | null;
  character_id: string | null;
  queue_position: number;
  queue_status: string;
  audio_file_ref: string | null;
}

export default function AudioQueue({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);

  const load = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/audio-queue`);
    if (r.ok) setEntries(await r.json());
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [campaignId]);

  const handlePlay = async (entryId: string) => {
    await apiFetch(`/campaigns/${campaignId}/audio-queue/${entryId}/play`, {
      method: "POST",
    });
    load();
  };

  const handleCancel = async (entryId: string) => {
    await apiFetch(`/campaigns/${campaignId}/audio-queue/${entryId}`, {
      method: "DELETE",
    });
    load();
  };

  if (entries.length === 0) return null;

  return (
    <div style={styles.container}>
      <h4 style={styles.title}>Audio Queue ({entries.length})</h4>
      {entries.map((e) => (
        <div key={e.id} style={styles.entry}>
          <p style={styles.text}>{e.final_text?.slice(0, 100)}...</p>
          <div style={{ display: "flex", gap: "6px" }}>
            {e.queue_status === "pending" && e.audio_file_ref && (
              <button onClick={() => handlePlay(e.id)} style={styles.playBtn}>
                Play
              </button>
            )}
            {e.queue_status === "pending" && !e.audio_file_ref && (
              <span style={{ color: "#f87171", fontSize: "11px" }}>No audio (TTS failed)</span>
            )}
            {e.queue_status === "playing" && (
              <span style={{ color: "#4ade80", fontSize: "12px" }}>Playing...</span>
            )}
            <button onClick={() => handleCancel(e.id)} style={styles.cancelBtn}>
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    width: "320px",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "12px",
    padding: "12px",
    zIndex: 100,
    maxHeight: "300px",
    overflowY: "auto",
  },
  title: { margin: "0 0 8px", fontSize: "13px", color: "#c084fc" },
  entry: {
    padding: "8px",
    borderBottom: "1px solid #2a2a2a",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
  },
  text: { margin: 0, fontSize: "12px", color: "#aaa", flex: 1 },
  playBtn: {
    padding: "4px 12px",
    borderRadius: "4px",
    border: "none",
    background: "#4ade80",
    color: "#000",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "4px 8px",
    borderRadius: "4px",
    border: "1px solid #555",
    background: "none",
    color: "#888",
    fontSize: "11px",
    cursor: "pointer",
  },
};
