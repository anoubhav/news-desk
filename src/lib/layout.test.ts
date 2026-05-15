import { describe, expect, it } from "vitest";
import { getCompositionLabel, getLayoutMode, toggleAnchor } from "./layout";

describe("layout helpers", () => {
  it("keeps at least one anchor selected", () => {
    expect(toggleAnchor(["neutral"], "neutral")).toEqual(["neutral"]);
  });

  it("returns ordered anchor combinations", () => {
    expect(toggleAnchor(["right"], "neutral")).toEqual(["neutral", "right"]);
    expect(getCompositionLabel(["right", "neutral"])).toBe("Neutral + Right");
  });

  it("maps anchor counts to layout modes", () => {
    expect(getLayoutMode(["neutral"])).toBe("solo");
    expect(getLayoutMode(["neutral", "left"])).toBe("duo");
    expect(getLayoutMode(["neutral", "left", "right"])).toBe("trio");
  });
});
