import { ImagePlus, X } from "lucide-react";
import { imageImportSummary } from "../hooks/use-image-import";
import type { ImageImportResult } from "../types";

export function ImageImportFeedback({ busy, result, onDismiss }: { busy: boolean; result: ImageImportResult | null; onDismiss: () => void }) {
  if (busy) return <div className="image-import-progress" role="status"><ImagePlus size={12} />Adding images…</div>;
  if (!result || (!result.issues.length && !result.warnings.length)) return null;
  return <section className="image-import-feedback" aria-label="Image import result" aria-live="polite">
    <header><strong>{imageImportSummary(result)}</strong><button type="button" aria-label="Dismiss image import result" onClick={onDismiss}><X size={13} /></button></header>
    <ul>{result.issues.map((issue, index) => <li key={`error-${index}`} data-tone="error">{issue.name ? <span>{issue.name}: </span> : null}{issue.message}</li>)}{result.warnings.map((warning, index) => <li key={`warning-${index}`}>{warning.name ? <span>{warning.name}: </span> : null}{warning.message}</li>)}</ul>
  </section>;
}
