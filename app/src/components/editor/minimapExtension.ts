import { showMinimap } from "@replit/codemirror-minimap";
import { Compartment, EditorState } from "@codemirror/state";

export const minimapCompartment = new Compartment();

export function createMinimapExtension(enabled: boolean) {
  if (!enabled) return minimapCompartment.of([]);
  return makeMinimapExt();
}

function makeMinimapExt() {
  return minimapCompartment.of(
    showMinimap.compute(["doc"], () => ({
      create: () => ({ dom: document.createElement("div") }),
      displayText: "characters",
      showOverlay: "always",
    }))
  );
}

export function toggleMinimap(state: EditorState, enabled: boolean) {
  const effect = enabled
    ? minimapCompartment.reconfigure(
        showMinimap.compute(["doc"], () => ({
          create: () => ({ dom: document.createElement("div") }),
          displayText: "characters",
          showOverlay: "always",
        }))
      )
    : minimapCompartment.reconfigure([]);
  return { effects: [effect] };
}
