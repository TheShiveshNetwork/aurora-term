type Listener = () => void;

let backgroundReady = false;
let videoReady = false;
let fired = false;
const listeners = new Set<Listener>();

const maybeFire = () => {
  if (fired || !backgroundReady || !videoReady) return;
  fired = true;
  const pending = Array.from(listeners);
  listeners.clear();
  pending.forEach((listener) => listener());
};

export const markBackgroundReady = () => {
  backgroundReady = true;
  maybeFire();
};

export const markVideoReady = () => {
  videoReady = true;
  maybeFire();
};

export const onPageReady = (listener: Listener): (() => void) => {
  if (fired) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
};