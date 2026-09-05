import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Meta } from "../types";
import { t } from "../lib/i18n.ts";

export function ContinueLoadingOverlay({ item, onCancel }: { item: Meta; onCancel(): void }) {
  const [logoReady, setLogoReady] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <div className="detail-entry-overlay is-visible continue-entry-overlay">
      <div className="detail-entry-loading-content" role="status" aria-label={`${t("common.loading")} ${item.name}`}>
        <div className="continue-entry-brand">
          {item.logo && !logoFailed && (
            <img src={item.logo} alt={item.name} style={{ opacity: logoReady ? 1 : 0 }}
              onLoad={() => setLogoReady(true)} onError={() => setLogoFailed(true)} />
          )}
          {(!item.logo || !logoReady || logoFailed) && <h2>{item.name}</h2>}
        </div>
        <i className="mini-spinner" aria-hidden="true" />
      </div>
      <button className="circle-button back" aria-label={t("action.cancel")} onClick={onCancel}>
        <ArrowLeft />
      </button>
    </div>
  );
}
