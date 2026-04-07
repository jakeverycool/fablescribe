import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
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
      <div style={styles.container}>
        <p style={{ padding: "24px", color: "#666" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link to="/" style={styles.back}>
            &larr;
          </Link>
          <h1 style={styles.title}>{campaign.name}</h1>
        </div>
        <button
          onClick={async () => {
            if (!confirm("Re-vectorize all characters, glossary, and memory? This is safe to run multiple times.")) return;
            const r = await apiFetch(`/campaigns/${campaign.id}/reindex`, { method: "POST" });
            if (r.ok) {
              const counts = await r.json();
              alert(`Reindex complete:\n${counts.characters} characters\n${counts.glossary} glossary entries\n${counts.memory} memory entries\n${counts.skipped} skipped`);
            } else {
              alert("Reindex failed");
            }
          }}
          style={styles.reindexBtn}
        >
          Reindex
        </button>
      </header>

      <nav style={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.tabActive : {}),
            }}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {activeTab === "Characters" && <CharactersTab campaignId={campaign.id} />}
        {activeTab === "Players" && <PlayersTab campaignId={campaign.id} />}
        {activeTab === "Glossary" && <GlossaryTab campaignId={campaign.id} />}
        {activeTab === "Sessions" && <SessionsTab campaignId={campaign.id} />}
        {activeTab === "Files" && <FilesTab campaignId={campaign.id} />}
        {activeTab === "Memory" && <MemoryTab campaignId={campaign.id} />}
        {activeTab === "Chatbot" && <ChatbotTab campaignId={campaign.id} messages={chatMessages} setMessages={setChatMessages} />}
      </main>

      <AudioQueue campaignId={campaign.id} />
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
    padding: "16px 24px",
    borderBottom: "1px solid #2a2a2a",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reindexBtn: {
    background: "none",
    border: "1px solid #333",
    color: "#888",
    padding: "6px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "12px",
  },
  back: {
    color: "#888",
    textDecoration: "none",
    fontSize: "18px",
  },
  title: { fontSize: "18px", margin: 0 },
  tabs: {
    display: "flex",
    gap: "0",
    borderBottom: "1px solid #2a2a2a",
    padding: "0 24px",
    overflowX: "auto",
  },
  tab: {
    padding: "12px 16px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#888",
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  tabActive: {
    color: "#e0e0e0",
    borderBottomColor: "#7c3aed",
  },
  main: {
    padding: "24px",
  },
};
