import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/supabase";
import { useToast } from "../lib/toast";

interface CampaignFile {
  id: string;
  filename: string;
  display_name: string | null;
  file_kind: string;
  file_size_bytes: number;
  description: string | null;
  tags: string[];
  created_at: string;
}

export default function FilesTab({ campaignId }: { campaignId: string }) {
  const toast = useToast();
  const [files, setFiles] = useState<CampaignFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = await apiFetch(`/campaigns/${campaignId}/files`);
    if (r.ok) setFiles(await r.json());
  };

  useEffect(() => {
    load();
  }, [campaignId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const form = new FormData();
    form.append("file", file);

    const resp = await apiFetch(`/campaigns/${campaignId}/files`, {
      method: "POST",
      body: form,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      toast.show(err.detail || "Upload failed", "error");
    } else {
      toast.show("File uploaded", "success");
    }

    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    load();
  };

  const handleDownload = async (fileId: string) => {
    const r = await apiFetch(`/campaigns/${campaignId}/files/${fileId}/download`);
    if (r.ok) {
      const { url } = await r.json();
      window.open(url, "_blank");
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-header__title">Files</h2>
        <div className="tab-header__actions">
          <label className="btn btn--primary" style={{ cursor: "pointer" }}>
            {uploading ? "Uploading…" : "+ Upload File"}
            <input
              ref={fileInput}
              type="file"
              accept=".docx,.txt,.md,.pdf,.png,.jpg,.jpeg,.gif,.webp"
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </div>

      {files.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__title">No files yet.</div>
          <p className="empty-state__body">
            Upload session prep, maps, handouts, and lore docs. The chatbot will index text-based files.
          </p>
        </div>
      )}

      <div className="list-stack">
        {files.map((f) =>
          editing === f.id ? (
            <FileEditForm
              key={f.id}
              file={f}
              campaignId={campaignId}
              onDone={() => { setEditing(null); load(); }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={f.id} className="list-card">
              <div className="list-card__header">
                <div>
                  <div className="list-card__title">{f.display_name || f.filename}</div>
                  <div className="list-card__meta">
                    <span className="badge badge--neutral">{f.file_kind}</span>
                    <span className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                      {formatSize(f.file_size_bytes)}
                    </span>
                  </div>
                </div>
                <div className="list-card__actions">
                  <button onClick={() => handleDownload(f.id)} className="btn btn--secondary btn--sm">Download</button>
                  <button onClick={() => setEditing(f.id)} className="btn btn--secondary btn--sm">Edit</button>
                  <button
                    onClick={async () => {
                      await apiFetch(`/campaigns/${campaignId}/files/${f.id}`, { method: "DELETE" });
                      load();
                    }}
                    className="btn btn--ghost btn--sm"
                    style={{ color: "var(--danger)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {f.description && <div className="list-card__body">{f.description}</div>}
              {f.tags.length > 0 && (
                <div className="list-card__footer">
                  {f.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function FileEditForm({
  file, campaignId, onDone, onCancel,
}: {
  file: CampaignFile; campaignId: string; onDone: () => void; onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(file.display_name || file.filename);
  const [description, setDescription] = useState(file.description || "");
  const [tags, setTags] = useState(file.tags.join(", "));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/campaigns/${campaignId}/files/${file.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        display_name: displayName,
        description: description || null,
        tags: tags ? tags.split(",").map((s) => s.trim()).filter(Boolean) : [],
      }),
    });
    onDone();
  };

  return (
    <form onSubmit={save} className="form-panel">
      <div className="form-panel__title">Edit file</div>

      <div className="form-group">
        <label className="form-label">Display name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
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
        <button type="submit" className="btn btn--primary">Save</button>
        <button type="button" onClick={onCancel} className="btn btn--ghost">Cancel</button>
      </div>
    </form>
  );
}
