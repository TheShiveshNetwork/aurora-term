import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { oneDarkTheme } from "@codemirror/theme-one-dark";
import { atomone } from "@uiw/codemirror-theme-atomone";
import { bespin } from "@uiw/codemirror-theme-bespin";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { githubDark } from "@uiw/codemirror-theme-github";
import { materialDark } from "@uiw/codemirror-theme-material";
import { monokai } from "@uiw/codemirror-theme-monokai";
import { nord } from "@uiw/codemirror-theme-nord";
import { okaidia } from "@uiw/codemirror-theme-okaidia";
import { solarizedDark } from "@uiw/codemirror-theme-solarized";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { xcodeDark } from "@uiw/codemirror-theme-xcode";
import type { EditorThemeName } from "../../stores/useSettingsStore";

export const READONLY_EDITOR_THEME = EditorView.theme({
  "&": { backgroundColor: "transparent", height: "100%" },
  ".cm-gutters": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.022)" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: "12px", lineHeight: "1.65" },
  ".cm-content": { padding: "4px 0" },
});

export const EDITOR_THEMES: Record<EditorThemeName, Extension> = {
  "one-dark": oneDarkTheme,
  atomone,
  bespin,
  dracula,
  github: githubDark,
  material: materialDark,
  monokai,
  nord,
  okaidia,
  solarized: solarizedDark,
  "tokyo-night": tokyoNight,
  vscode: vscodeDark,
  xcode: xcodeDark,
};
