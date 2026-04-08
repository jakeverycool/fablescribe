import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { useToast } from "../lib/toast";

interface QueueEntry {
  id: string;
  final_text: string | null;
  character_id: string | null;
  queue_position: number;
  queue_status: string;
  audio_file_ref: string | null;
}

export default function AudioQueue({ campaignId }: { campaignId: string }) {
  const toast = useToast();
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
    const r = await apiFetch(`/campaigns/${campaignId}/audio-queue/${entryId}/play`, {
      method: "POST",
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast.show(err.detail || `Playback failed (HTTP ${r.status})`, "error");
    }
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
    <div className="audio-queue">
      <div className="audio-queue__title">Audio Queue ({entries.length})</div>
      {entries.map((e) => (
        <div key={e.id} className="audio-queue__entry">
          <div className="audio-queue__text">
            {e.final_text?.slice(0, 100)}
            {(e.final_text?.length ?? 0) > 100 ? "…" : ""}
          </div>
          <div className="audio-queue__row">
            {e.queue_status === "pending" && e.audio_file_ref && (
              <button onClick={() => handlePlay(e.id)} className="btn btn--gold btn--sm">
                Play
              </button>
            )}
            {e.queue_status === "pending" && !e.audio_file_ref && (
              <span className="badge badge--danger">No audio</span>
            )}
            {e.queue_status === "playing" && (
              <span className="status-dot status-dot--active">Playing</span>
            )}
            <button
              onClick={() => handleCancel(e.id)}
              className="btn btn--ghost btn--sm"
              style={{ marginLeft: "auto" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
