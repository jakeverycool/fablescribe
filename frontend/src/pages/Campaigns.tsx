import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { apiFetch } from "../lib/supabase";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export default function Campaigns() {
  const { signOut } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const resp = await apiFetch("/campaigns");
    if (resp.ok) setCampaigns(await resp.json());
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);

    const resp = await apiFetch("/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    });

    if (resp.ok) {
      setName("");
      setDescription("");
      await load();
    }
    setCreating(false);
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Fablescribe</h1>
        <button onClick={signOut} style={styles.signOut}>
          Sign Out
        </button>
      </header>

      <main style={styles.main}>
        <h2 style={styles.sectionTitle}>Your Campaigns</h2>

        <form onSubmit={handleCreate} style={styles.createForm}>
          <input
            placeholder="Campaign name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={styles.input}
          />
          <input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={styles.input}
          />
          <button type="submit" disabled={creating} style={styles.createBtn}>
            {creating ? "Creating..." : "Create Campaign"}
          </button>
        </form>

        {campaigns.length === 0 ? (
          <p style={styles.empty}>No campaigns yet. Create one above.</p>
        ) : (
          <div style={styles.grid}>
            {campaigns.map((c) => (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                style={styles.card}
              >
                <h3 style={styles.cardTitle}>{c.name}</h3>
                {c.description && (
                  <p style={styles.cardDesc}>{c.description}</p>
                )}
                <span style={styles.cardDate}>
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#0f0f0f",
    color: "#e0e0e0",
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 24px",
    borderBottom: "1px solid #2a2a2a",
  },
  title: { fontSize: "18px", margin: 0 },
  signOut: {
    background: "none",
    border: "1px solid #333",
    color: "#888",
    padding: "6px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "12px",
  },
  main: { padding: "24px", maxWidth: "800px", margin: "0 auto" },
  sectionTitle: { fontSize: "16px", marginBottom: "16px" },
  createForm: { display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" },
  input: {
    flex: 1,
    minWidth: "200px",
    padding: "10px 14px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#e0e0e0",
    fontSize: "13px",
    outline: "none",
  },
  createBtn: {
    padding: "10px 20px",
    borderRadius: "6px",
    border: "none",
    background: "#7c3aed",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  empty: { color: "#555", fontStyle: "italic" },
  grid: { display: "flex", flexDirection: "column", gap: "8px" },
  card: {
    display: "block",
    padding: "16px",
    background: "#1a1a1a",
    borderRadius: "8px",
    textDecoration: "none",
    color: "#e0e0e0",
    border: "1px solid #2a2a2a",
  },
  cardTitle: { margin: "0 0 4px", fontSize: "15px" },
  cardDesc: { margin: "0 0 8px", fontSize: "13px", color: "#888" },
  cardDate: { fontSize: "11px", color: "#555" },
};
