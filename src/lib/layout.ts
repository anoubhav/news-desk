import type { AnchorId } from "@shared/models";

const anchorOrder: AnchorId[] = ["neutral", "left", "right"];

export function sortAnchors(selectedAnchors: AnchorId[]) {
  return [...selectedAnchors].sort((left, right) => anchorOrder.indexOf(left) - anchorOrder.indexOf(right));
}

export function toggleAnchor(current: AnchorId[], anchorId: AnchorId) {
  if (current.includes(anchorId)) {
    if (current.length === 1) {
      return current;
    }
    return current.filter((value) => value !== anchorId);
  }

  return sortAnchors([...current, anchorId]);
}

export function getLayoutMode(selectedAnchors: AnchorId[]) {
  if (selectedAnchors.length >= 3) {
    return "trio";
  }

  if (selectedAnchors.length === 2) {
    return "duo";
  }

  return "solo";
}

export function getCompositionLabel(selectedAnchors: AnchorId[]) {
  const ordered = sortAnchors(selectedAnchors);
  return ordered.map((anchorId) => anchorId[0].toUpperCase() + anchorId.slice(1)).join(" + ");
}
