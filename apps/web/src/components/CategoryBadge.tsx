import { CATEGORY_LABELS, type IceCategory } from "@openice/shared";

export function CategoryBadge({ category, compact = false }: { category: IceCategory; compact?: boolean }) {
  return (
    <span className={`badge cat-${category}${compact ? " compact" : ""}`} title={CATEGORY_LABELS[category]}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}
