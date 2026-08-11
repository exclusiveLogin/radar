/**
 * Единый резолвер грунтовки LLM-узла к кандидатам / raw (Wave 7).
 * Стеммер — тот же, что uniqueStem / matchedViaAdjectiveStem (placeStem + collectPlaceMatchStems).
 */
import type { EventCandidate, GeoNode, ParseWorkspace, TextSpan } from "@radar/shared";
import { collectPlaceMatchStems, placeStem } from "@radar/shared";
import { listActiveCandidates } from "../parseProcessorContract.js";

export type LlmGroundingOutcome =
  | {
      kind: "matched-candidate";
      candidate: EventCandidate;
      /** Каноническое имя из каталожного кандидата. */
      canonicalName: string;
    }
  | {
      kind: "llm-only";
      span: TextSpan;
      canonicalName: string;
    }
  | {
      kind: "ungrounded";
      span: TextSpan;
      canonicalName: string;
    };

/** Мягкое согласие стеммов: точное равенство или короткий падежный хвост (Белгород/Белгорода). */
export function stemsAgree(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 4) return false;
  if (longer.startsWith(shorter) && longer.length - shorter.length <= 3) return true;
  const shared = Math.max(4, shorter.length - 2);
  return (
    longer.slice(0, shared) === shorter.slice(0, shared)
    && Math.abs(a.length - b.length) <= 3
  );
}

function stemSet(name: string): string[] {
  const stems = collectPlaceMatchStems(name);
  const primary = placeStem(name);
  if (primary && !stems.includes(primary)) stems.push(primary);
  return stems.filter(Boolean);
}

/** Два имени совпадают по стеммеру (в т.ч. склонённая форма). */
export function namesStemMatch(a: string, b: string): boolean {
  const left = stemSet(a);
  const right = stemSet(b);
  for (const ls of left) {
    for (const rs of right) {
      if (stemsAgree(ls, rs)) return true;
    }
  }
  return false;
}

function findStemSpanInText(text: string, placeName: string): TextSpan | null {
  const needleStems = stemSet(placeName);
  if (needleStems.length === 0) return null;

  const wordRe = /[\p{L}\p{N}-]+/gu;
  for (const match of text.matchAll(wordRe)) {
    const word = match[0]!;
    const idx = match.index ?? 0;
    const wordStems = stemSet(word);
    const hit = needleStems.some((ns) => wordStems.some((ws) => stemsAgree(ns, ws)));
    if (!hit) continue;
    return {
      start: idx,
      end: idx + word.length,
      matchedText: text.slice(idx, idx + word.length),
    };
  }
  return null;
}

function matchExistingCandidate(
  candidates: EventCandidate[],
  node: GeoNode,
): EventCandidate | null {
  const regionCode = node.regionCode;
  for (const candidate of candidates) {
    if (
      candidate.anchor.kind === "region"
      && node.kind === "region"
      && regionCode
      && candidate.anchor.regionCode === regionCode
    ) {
      return candidate;
    }
    const name = candidate.anchor.name;
    if (!name || !node.name) continue;
    if (namesStemMatch(name, node.name)) return candidate;
  }
  return null;
}

/**
 * Исход грунтовки одного LLM-узла относительно workspace.
 * matched → канон из каталога; llm-only → есть в raw; ungrounded → нет ни там, ни там.
 */
export function resolveLlmNodeGrounding(
  node: GeoNode,
  workspace: ParseWorkspace,
): LlmGroundingOutcome {
  const name = node.name?.trim() ?? "";
  const active = listActiveCandidates(workspace);
  const matched = name ? matchExistingCandidate(active, node) : null;
  if (matched) {
    return {
      kind: "matched-candidate",
      candidate: matched,
      canonicalName: matched.anchor.name?.trim() || name,
    };
  }

  const spanInRaw = name ? findStemSpanInText(workspace.groomedText, name) : null;
  if (spanInRaw) {
    return {
      kind: "llm-only",
      span: spanInRaw,
      canonicalName: name,
    };
  }

  // Нет опоры в тексте — span на имя узла в начале (не на всё сообщение).
  const fallbackSpan: TextSpan = {
    start: 0,
    end: Math.min(name.length, workspace.groomedText.length) || 0,
    matchedText: name,
  };
  return {
    kind: "ungrounded",
    span: fallbackSpan,
    canonicalName: name,
  };
}
