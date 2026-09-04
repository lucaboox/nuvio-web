import { Eye, EyeOff } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { officialBackend, normalizeBackend, signIn } from "../lib/account";
import type { Session } from "../types";

export function AuthScreen({ onSession }: { onSession(session: Session): void }) {
  const official = useMemo(officialBackend, []);
  const [selfHosted, setSelfHosted] = useState(!official);
  const [backendUrl, setBackendUrl] = useState("");
  const [key, setKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const backend = selfHosted ? normalizeBackend(backendUrl, key) : official;
      if (!backend) throw new Error("This build has no official backend. Use a self-hosted backend.");
      const session = await signIn(backend, email, password);
      if (!session) setMessage("Confirm your email address, then sign in."); else onSession(session);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sign in failed"); }
    finally { setBusy(false); }
  }

  return <main className="auth-screen">
    <section className="auth-card">
      <img className="auth-logo" src={`${import.meta.env.BASE_URL}nuvio-wordmark.png`} alt="Nuvio" />
      <h1>Your Nuvio, anywhere.</h1>
      <p>Install it from Safari or Chrome and keep your profiles, addons, and library in sync.</p>
      <form onSubmit={submit}>
        <label className="check-row">
          <span>
            <strong>Self-hosted backend</strong>
            <small>Use your own Nuvio server and publishable key.</small>
          </span>
          {/* The same switch the rest of the app uses. A bare checkbox here was
              the only one left, and it is a far smaller target than the control
              it sits above. */}
          <span className="switch">
            <input
              type="checkbox"
              checked={selfHosted}
              onChange={(event) => setSelfHosted(event.target.checked)}
            />
            <i />
          </span>
        </label>
        {selfHosted && <div className="host-fields"><label>Backend URL<input type="url" value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} placeholder="https://nuvio.example.com" required /></label><label>Publishable key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} required /></label></div>}
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
        <button className="primary wide" disabled={busy}>{busy ? "Connecting…" : "Sign in"}</button>
      </form>
      {message && <div className="notice error">{message}</div>}
      <a className="text-button" href="https://nuvio.tv/account/signup?next=%2Faccount" target="_blank" rel="noreferrer">New to Nuvio? Create an account</a>
    </section>
  </main>;
}
