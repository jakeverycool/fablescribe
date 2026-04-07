import { createClient } from "@supabase/supabase-js";

// All three are read from Vite env vars at build time.
// In local dev: defined in frontend/.env.local
// In Vercel: defined per project (dev / prod) in the Vercel dashboard
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loudly during build/dev so missing env vars are caught immediately
  throw new Error(
    "Missing required env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. " +
      "Set them in frontend/.env.local for local dev, or in your Vercel project settings for deploys."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Backend URL: explicit env var takes precedence (set this in production), then fall back
// to deriving from the current page hostname for local dev / LAN access.
const ENV_API_BASE = import.meta.env.VITE_BACKEND_URL as string | undefined;
const API_BASE =
  ENV_API_BASE && ENV_API_BASE.length > 0
    ? ENV_API_BASE
    : `${window.location.protocol}//${window.location.hostname}:8000`;

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  if (
    !headers["Content-Type"] &&
    options.body &&
    typeof options.body === "string"
  ) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${API_BASE}${path}`, { ...options, headers });
}
