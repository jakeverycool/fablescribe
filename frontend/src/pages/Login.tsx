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
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__brand">Fablescribe</div>
        <p className="auth-card__tagline">Where every campaign becomes legend.</p>

        {sent ? (
          <p className="form-success">Check your email for the login link.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={`form-input${error ? " error" : ""}`}
              />
              {error && <p className="form-error">{error}</p>}
            </div>
            <button type="submit" className="btn btn--primary btn--block btn--lg">
              Send Magic Link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
