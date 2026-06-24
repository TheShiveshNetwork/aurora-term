import { showMinimap } from "@replit/codemirror-minimap";
import { EditorView } from "@codemirror/view";

const minimapCreate = (view: EditorView) => {
  const dom = document.createElement("div");
  return { dom };
};

export const minimapExtension = showMinimap.compute(["doc"], () => ({
  create: minimapCreate,
  displayText: "characters",
  showOverlay: "always",
}));
