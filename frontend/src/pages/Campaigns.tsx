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
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
      }),
    });

    if (resp.ok) {
      setName("");
      setDescription("");
      await load();
    }
    setCreating(false);
  };

  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="topnav__left">
          <Link to="/" className="topnav__brand">
            Fablescribe
          </Link>
        </div>
        <div className="topnav__right">
          <button onClick={signOut} className="btn btn--secondary btn--sm">
            Sign Out
          </button>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero__eyebrow">Your Library</div>
          <h1 className="hero__title">Campaigns</h1>
          <p className="hero__subtitle">
            Every great story starts with a single session.
          </p>
        </section>

        <h3 className="subsection-title">Begin a new tale</h3>
        <form onSubmit={handleCreate} className="panel">
          <div className="form-group">
            <label className="form-label" htmlFor="campaign-name">
              Campaign name
            </label>
            <input
              id="campaign-name"
              placeholder="The Crimson Crown"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="campaign-desc">
              Description <span style={{ color: "var(--tome-400)" }}>(optional)</span>
            </label>
            <input
              id="campaign-desc"
              placeholder="A short pitch for the campaign…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-input"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="btn btn--primary"
          >
            {creating ? "Creating…" : "Create Campaign"}
          </button>
        </form>

        <h3 className="subsection-title">Your campaigns</h3>
        {campaigns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__title">Your tavern is quiet… for now.</div>
            <p className="empty-state__body">
              Create your first campaign above to start chronicling sessions.
            </p>
          </div>
        ) : (
          <div className="card-grid">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                className="card card--link"
              >
                <h3 className="card__title">{c.name}</h3>
                {c.description && <p className="card__body">{c.description}</p>}
                <div className="card__meta">
                  Created {new Date(c.created_at).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
