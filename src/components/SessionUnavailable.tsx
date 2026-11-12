import { RefreshCw } from "lucide-react";
import { t } from "../lib/i18n.ts";

/**
 * Shown when the saved session could not be checked at launch: the backend
 * did not answer, so it is not known whether you are still signed in. Not the
 * sign-in screen, which is what this used to fall through to, asking for a
 * password the account never stopped accepting.
 */
export function SessionUnavailable({
  retrying,
  onRetry,
  onSignIn,
}: {
  retrying: boolean;
  onRetry(): void;
  onSignIn(): void;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-card session-unavailable" role="status" aria-live="polite">
        <img
          className="auth-logo"
          src={`${import.meta.env.BASE_URL}nuvio-wordmark.png`}
          alt="Nuvio"
        />
        <h1>{t("session.unavailableTitle")}</h1>
        <p>{t("session.unavailableBody")}</p>
        <button type="button" className="primary" disabled={retrying} onClick={onRetry}>
          {retrying ? (
            <i className="mini-spinner" aria-hidden="true" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          {retrying ? t("session.retrying") : t("action.retry")}
        </button>
        <button type="button" className="session-unavailable-alt" onClick={onSignIn}>
          {t("session.signInInstead")}
        </button>
      </section>
    </main>
  );
}
