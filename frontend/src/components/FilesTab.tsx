import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/supabase";

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

    // apiFetch handles auth + base URL, and skips Content-Type for FormData bodies
    const resp = await apiFetch(`/campaigns/${campaignId}/files`, {
      method: "POST",
      body: form,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(err.detail || "Upload failed");
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
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "15px" }}>Files</h3>
        <label style={styles.btn}>
          {uploading ? "Uploading..." : "+ Upload File"}
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

      {files.length === 0 && (
        <p style={{ color: "#555", fontStyle: "italic" }}>No files uploaded yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
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
            <div key={f.id} style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{f.display_name || f.filename}</strong>
                  <span style={styles.badge}>{f.file_kind}</span>
                  <span style={{ color: "#555", fontSize: "11px", marginLeft: "8px" }}>
                    {formatSize(f.file_size_bytes)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => handleDownload(f.id)} style={styles.smallBtn}>Download</button>
                  <button onClick={() => setEditing(f.id)} style={styles.smallBtn}>Edit</button>
                  <button
                    onClick={async () => {
                      await apiFetch(`/campaigns/${campaignId}/files/${f.id}`, { method: "DELETE" });
                      load();
                    }}
                    style={{ ...styles.smallBtn, color: "#f87171" }}
                  >Delete</button>
                </div>
              </div>
              {f.description && <p style={styles.desc}>{f.description}</p>}
              {f.tags.length > 0 && (
                <div style={{ marginTop: "4px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {f.tags.map((t) => <span key={t} style={styles.tag}>{t}</span>)}
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
    <form onSubmit={save} style={styles.form}>
      <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={styles.input} />
      <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={styles.textarea} />
      <input placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} style={styles.input} />
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" style={styles.btn}>Save</button>
        <button type="button" onClick={onCancel} style={styles.smallBtn}>Cancel</button>
      </div>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { padding: "12px 16px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #2a2a2a" },
  desc: { margin: "4px 0 0", fontSize: "13px", color: "#888" },
  badge: { display: "inline-block", marginLeft: "8px", padding: "2px 8px", borderRadius: "4px", background: "#2a2a2a", color: "#aaa", fontSize: "11px" },
  tag: { padding: "2px 6px", borderRadius: "3px", background: "#1e1e3a", color: "#a78bfa", fontSize: "11px" },
  btn: { padding: "8px 16px", borderRadius: "6px", border: "none", background: "#7c3aed", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" },
  smallBtn: { background: "none", border: "1px solid #333", color: "#888", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "8px", padding: "16px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #2a2a2a", marginBottom: "12px" },
  input: { padding: "8px 12px", borderRadius: "6px", border: "1px solid #333", background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none" },
  textarea: { padding: "8px 12px", borderRadius: "6px", border: "1px solid #333", background: "#0f0f0f", color: "#e0e0e0", fontSize: "13px", outline: "none", minHeight: "60px", resize: "vertical" as const, fontFamily: "inherit" },
};
