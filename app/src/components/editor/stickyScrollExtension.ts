import { stickyScroll } from "@fazelstudio/codemirror-stickyscroll";
import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

export const stickyScrollCompartment = new Compartment();

export function createStickyScrollExtension(enabled: boolean): Extension {
  return stickyScrollCompartment.of(enabled ? stickyScroll({ maxStickyLines: 4 }) : []);
}

export function toggleStickyScroll(enabled: boolean) {
  return {
    effects: stickyScrollCompartment.reconfigure(enabled ? stickyScroll({ maxStickyLines: 4 }) : []),
  };
}
