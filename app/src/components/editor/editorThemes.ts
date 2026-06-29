import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorThemeName } from "../../stores/useSettingsStore";

export function createThemeCompartment(): Compartment {
  return new Compartment();
}

export const READONLY_EDITOR_THEME = EditorView.theme({
  "&": { backgroundColor: "transparent", height: "100%" },
  ".cm-gutters": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.022)" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: "12px", lineHeight: "1.65" },
  ".cm-content": { padding: "4px 0" },
});

export async function getEditorTheme(name: EditorThemeName): Promise<Extension> {
  switch (name) {
    case "one-dark": {
      const { oneDarkTheme } = await import("@codemirror/theme-one-dark");
      return oneDarkTheme;
    }
    case "atomone": {
      const { atomone } = await import("@uiw/codemirror-theme-atomone");
      return atomone;
    }
    case "bespin": {
      const { bespin } = await import("@uiw/codemirror-theme-bespin");
      return bespin;
    }
    case "dracula": {
      const { dracula } = await import("@uiw/codemirror-theme-dracula");
      return dracula;
    }
    case "github": {
      const { githubDark } = await import("@uiw/codemirror-theme-github");
      return githubDark;
    }
    case "material": {
      const { materialDark } = await import("@uiw/codemirror-theme-material");
      return materialDark;
    }
    case "monokai": {
      const { monokai } = await import("@uiw/codemirror-theme-monokai");
      return monokai;
    }
    case "nord": {
      const { nord } = await import("@uiw/codemirror-theme-nord");
      return nord;
    }
    case "okaidia": {
      const { okaidia } = await import("@uiw/codemirror-theme-okaidia");
      return okaidia;
    }
    case "solarized": {
      const { solarizedDark } = await import("@uiw/codemirror-theme-solarized");
      return solarizedDark;
    }
    case "tokyo-night": {
      const { tokyoNight } = await import("@uiw/codemirror-theme-tokyo-night");
      return tokyoNight;
    }
    case "vscode": {
      const { vscodeDark } = await import("@uiw/codemirror-theme-vscode");
      return vscodeDark;
    }
    case "xcode": {
      const { xcodeDark } = await import("@uiw/codemirror-theme-xcode");
      return xcodeDark;
    }
    default: {
      const { dracula } = await import("@uiw/codemirror-theme-dracula");
      return dracula;
    }
  }
}
