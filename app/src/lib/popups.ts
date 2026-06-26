const CLOSE_POPUPS_EVENT = "aurora-close-popups";

export function closeAllPopups(): void {
  window.dispatchEvent(new CustomEvent(CLOSE_POPUPS_EVENT));
}

export function onClosePopups(handler: () => void): () => void {
  window.addEventListener(CLOSE_POPUPS_EVENT, handler);
  return () => window.removeEventListener(CLOSE_POPUPS_EVENT, handler);
}
