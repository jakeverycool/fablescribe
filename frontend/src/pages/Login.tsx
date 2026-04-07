import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Fablescribe</h1>
        <p style={styles.subtitle}>DM storytelling toolkit</p>

        {sent ? (
          <p style={styles.success}>Check your email for the login link.</p>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
            />
            <button type="submit" style={styles.button}>
              Send Magic Link
            </button>
            {error && <p style={styles.error}>{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f0f0f",
  },
  card: {
    background: "#1a1a1a",
    borderRadius: "12px",
    padding: "48px",
    width: "400px",
    textAlign: "center",
  },
  title: {
    color: "#e0e0e0",
    fontSize: "28px",
    margin: "0 0 8px",
    fontFamily: "'JetBrains Mono', monospace",
  },
  subtitle: {
    color: "#666",
    fontSize: "14px",
    margin: "0 0 32px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  input: {
    padding: "12px 16px",
    borderRadius: "8px",
    border: "1px solid #333",
    background: "#0f0f0f",
    color: "#e0e0e0",
    fontSize: "14px",
    outline: "none",
  },
  button: {
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    background: "#7c3aed",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  },
  success: {
    color: "#4ade80",
    fontSize: "14px",
  },
  error: {
    color: "#f87171",
    fontSize: "13px",
    margin: 0,
  },
};
