import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// @hyperframes/player creates an iframe inside Shadow DOM on mount, which
// jsdom can't fully support — it throws "Cannot read properties of undefined
// (reading 'add')" inside createCompositionIframe. The tests don't exercise
// real Hyperframes playback, so stub the module to a no-op custom element.
vi.mock("@hyperframes/player", () => {
  if (typeof customElements !== "undefined" && !customElements.get("hyperframes-player")) {
    class StubPlayer extends HTMLElement {
      // intentionally empty
    }
    customElements.define("hyperframes-player", StubPlayer);
  }
  return {};
});
