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
