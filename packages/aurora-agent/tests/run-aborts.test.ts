import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRunAbort,
  isRunStopped,
  registerRunAbort,
  resetRunAborts,
  stopRun,
} from '../src/run-aborts';

afterEach(() => resetRunAborts());

describe('run aborts', () => {
  it('aborts the controller registered for a thread', () => {
    const controller = registerRunAbort('t1');
    expect(controller.signal.aborted).toBe(false);
    expect(stopRun('t1')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it('reports that the thread was stopped so retries can be suppressed', () => {
    registerRunAbort('t1');
    expect(isRunStopped('t1')).toBe(false);
    stopRun('t1');
    expect(isRunStopped('t1')).toBe(true);
  });

  it('leaves other threads alone', () => {
    const other = registerRunAbort('t2');
    registerRunAbort('t1');
    stopRun('t1');
    expect(other.signal.aborted).toBe(false);
    expect(isRunStopped('t2')).toBe(false);
  });

  it('reports nothing to stop when no run is in flight', () => {
    expect(stopRun('missing')).toBe(false);
    expect(isRunStopped('missing')).toBe(false);
  });

  it('clears the stopped flag when a new run starts for the same thread', () => {
    registerRunAbort('t1');
    stopRun('t1');
    expect(isRunStopped('t1')).toBe(true);

    // A fresh run must not inherit the previous stop, or it would refuse to retry.
    registerRunAbort('t1');
    expect(isRunStopped('t1')).toBe(false);
  });

  it('keeps the stopped flag after the controller is released', () => {
    registerRunAbort('t1');
    stopRun('t1');
    clearRunAbort('t1');
    expect(isRunStopped('t1')).toBe(true);
  });
});
