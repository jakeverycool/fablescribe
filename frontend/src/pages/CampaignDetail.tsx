import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { apiFetch } from "../lib/supabase";
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
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Sessions");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

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
    if (
      !confirm(
        "Re-vectorize all characters, glossary, and memory? This is safe to run multiple times.",
      )
    )
      return;
    const r = await apiFetch(`/campaigns/${campaign.id}/reindex`, {
      method: "POST",
    });
    if (r.ok) {
      const counts = await r.json();
      alert(
        `Reindex complete:\n${counts.characters} characters\n${counts.glossary} glossary entries\n${counts.memory} memory entries\n${counts.skipped} skipped`,
      );
    } else {
      alert("Reindex failed");
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
            onClick={handleReindex}
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
    </div>
  );
}
