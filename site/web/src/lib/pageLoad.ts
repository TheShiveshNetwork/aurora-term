type Listener = () => void;

let pendingBackground = 0;
let fired = false;
const listeners = new Set<Listener>();

const maybeFire = () => {
  if (fired || pendingBackground > 0) return;
  fired = true;
  const pending = Array.from(listeners);
  listeners.clear();
  pending.forEach((listener) => listener());
};

export const expectBackground = () => {
  pendingBackground += 1;
};

export const releaseBackground = () => {
  pendingBackground = Math.max(0, pendingBackground - 1);
};

export const markBackgroundReady = () => {
  releaseBackground();
  maybeFire();
};

export const onPageReady = (listener: Listener): (() => void) => {
  if (fired) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  if (pendingBackground === 0) {
    // Defer a tick so any expectation effects that still need to mount can
    // register their assets before we conclude there is nothing to load.
    const id = window.setTimeout(() => maybeFire(), 0);
    return () => {
      window.clearTimeout(id);
      listeners.delete(listener);
    };
  }
  return () => listeners.delete(listener);
};