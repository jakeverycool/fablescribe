import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { apiFetch } from "../lib/supabase";
import { useToast } from "../lib/toast";
import SessionsTab from "../components/SessionsTab";
import CharactersTab from "../components/CharactersTab";
import PlayersTab from "../components/PlayersTab";
import GlossaryTab from "../components/GlossaryTab";
import FilesTab from "../components/FilesTab";
import MemoryTab from "../components/MemoryTab";
import ChatbotTab, { type ChatMessage } from "../components/ChatbotTab";
import AudioQueue from "../components/AudioQueue";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
}

const TABS = [
  "Sessions",
  "Characters",
  "Players",
  "Glossary",
  "Files",
  "Memory",
  "Chatbot",
] as const;
type Tab = (typeof TABS)[number];

export default function CampaignDetail() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { signOut } = useAuth();
  const toast = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Sessions");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showReindex, setShowReindex] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    if (!campaignId) return;
    apiFetch(`/campaigns/${campaignId}`).then(async (r) => {
      if (r.ok) setCampaign(await r.json());
    });
  }, [campaignId]);

  if (!campaign) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <span>Loading the tome…</span>
      </div>
    );
  }

  const handleReindex = async () => {
    setReindexing(true);
    const r = await apiFetch(`/campaigns/${campaign.id}/reindex`, {
      method: "POST",
    });
    setReindexing(false);
    setShowReindex(false);
    if (r.ok) {
      const counts = await r.json();
      toast.show(
        `Reindex complete: ${counts.characters} characters, ${counts.glossary} glossary, ${counts.memory} memory (${counts.skipped} skipped)`,
        "success",
      );
    } else {
      toast.show("Reindex failed", "error");
    }
  };

  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="topnav__left">
          <Link to="/" className="topnav__brand">
            Fablescribe
          </Link>
          <div className="topnav__divider" />
          <Link to="/" className="topnav__back" aria-label="Back to campaigns">
            ←
          </Link>
          <h1 className="topnav__context">{campaign.name}</h1>
        </div>
        <div className="topnav__right">
          <button
            onClick={() => setShowReindex(true)}
            className="btn btn--secondary btn--sm"
          >
            Reindex
          </button>
          <button onClick={signOut} className="btn btn--secondary btn--sm">
            Sign Out
          </button>
        </div>
      </header>

      <main className="page">
        <nav className="tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`tab${activeTab === tab ? " active" : ""}`}
              role="tab"
              aria-selected={activeTab === tab}
            >
              {tab}
            </button>
          ))}
        </nav>

        {activeTab === "Characters" && <CharactersTab campaignId={campaign.id} />}
        {activeTab === "Players" && <PlayersTab campaignId={campaign.id} />}
        {activeTab === "Glossary" && <GlossaryTab campaignId={campaign.id} />}
        {activeTab === "Sessions" && <SessionsTab campaignId={campaign.id} />}
        {activeTab === "Files" && <FilesTab campaignId={campaign.id} />}
        {activeTab === "Memory" && <MemoryTab campaignId={campaign.id} />}
        {activeTab === "Chatbot" && (
          <ChatbotTab
            campaignId={campaign.id}
            messages={chatMessages}
            setMessages={setChatMessages}
          />
        )}
      </main>

      <AudioQueue campaignId={campaign.id} />

      {showReindex && (
        <div className="modal-backdrop" onClick={() => !reindexing && setShowReindex(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Reindex campaign?</div>
            </div>
            <div className="modal__body">
              Re-vectorize all characters, glossary, and memory entries. This is safe to run
              multiple times — existing vectors will be replaced.
            </div>
            <div className="modal__footer">
              <button
                onClick={() => setShowReindex(false)}
                disabled={reindexing}
                className="btn btn--ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleReindex}
                disabled={reindexing}
                className="btn btn--primary"
              >
                {reindexing ? "Reindexing…" : "Reindex"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
