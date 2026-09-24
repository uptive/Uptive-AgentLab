import type { ReactNode } from "react";
import type { RecommendationSeverity, RecommendationTag } from "@agentlab/contracts";

const SEVERITY_LABELS: Record<RecommendationSeverity, string> = { high: "High", medium: "Medium", low: "Low" };

/**
 * Severity as a colored, filled shape (circle with "!", diamond, dot) so it reads without relying on
 * color alone. `label` is the accessible text; defaults to "High severity" etc.
 */
export function SeverityIcon({ severity, label, size = 14 }: { severity: RecommendationSeverity; label?: string; size?: number }) {
  const text = label ?? `${SEVERITY_LABELS[severity]} severity`;
  return (
    <svg className={`opt-sev ${severity}`} width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={text}>
      <title>{text}</title>
      {severity === "high" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M8 4.2v4.6M8 11.2v.4" stroke="var(--on-sev)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : severity === "medium" ? (
        <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="currentColor" />
      ) : (
        <circle cx="8" cy="8" r="4.5" fill="currentColor" />
      )}
    </svg>
  );
}

// Outline icons (24×24, stroke), in the style of the other inline icons in the app.
const TAG_ICONS: Record<RecommendationTag, ReactNode> = {
  Input: (
    <>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </>
  ),
  Output: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  Instructions: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8" />
    </>
  ),
  Error: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  Cost: (
    <>
      <path d="M12 1v22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  Context: (
    <>
      <path d="M12 2 2 7l10 5 10-5-10-5z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </>
  ),
  Speed: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  Duplication: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  Responsibility: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m16 11 2 2 4-4" />
    </>
  ),
  Handoff: (
    <>
      <path d="m8 3-4 4 4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  Validation: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
};

export function TagIcon({ tag, size = 12 }: { tag: RecommendationTag; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TAG_ICONS[tag]}
    </svg>
  );
}

/** Icon + label chip for one tag. The visible label is the accessible text. */
export function TagChip({ tag }: { tag: RecommendationTag }) {
  return (
    <span className="opt-tag">
      <TagIcon tag={tag} />
      {tag}
    </span>
  );
}

export function TagList({ tags }: { tags?: RecommendationTag[] }) {
  if (!tags?.length) return null;
  return (
    <span className="opt-tags">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} />
      ))}
    </span>
  );
}
