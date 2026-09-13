import type { BookableOffering } from "@openice/shared";

export function offeringId(parts: Pick<BookableOffering, "provider" | "title" | "start" | "registerUrl">): string {
  const key = `${parts.provider}|${parts.start}|${parts.title.toLowerCase()}|${parts.registerUrl}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${parts.provider}-${(hash >>> 0).toString(36)}`;
}
