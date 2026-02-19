/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {EventManager} from '@angular/platform-browser';
import {discardPeriodicTasks, fakeAsync, flush, flushMicrotasks, inject, tick} from '../testing';
import {
  ɵFakeAsyncAdapter,
  ɵresetFakeAsyncAdapter,
  ɵsetFakeAsyncAdapter,
} from '../testing/src/fake_async';
import {Log} from '../testing/src/testing_internal';

const resolvedPromise = Promise.resolve(null);

describe('zoneless fake async', () => {
  beforeEach(() => {
    ɵsetFakeAsyncAdapter(new SimpleFakeAsyncAdapter());
  });

  afterEach(() => {
    ɵresetFakeAsyncAdapter();
  });

  it('should run synchronous code', () => {
    let ran = false;
    fakeAsync(() => {
      ran = true;
    })();

    expect(ran).toEqual(true);
  });

  it('should pass arguments to the wrapped function', () => {
    fakeAsync((foo: string, bar: string) => {
      expect(foo).toEqual('foo');
      expect(bar).toEqual('bar');
    })('foo', 'bar');
  });

  it('should work with inject()', fakeAsync(
    inject([EventManager], (eventManager: EventManager) => {
      expect(eventManager).toBeInstanceOf(EventManager);
    }),
  ));

  it('should throw on nested calls', () => {
    expect(() => {
      fakeAsync(() => {
        fakeAsync((): null => null)();
      })();
    }).toThrowError('fakeAsync() calls can not be nested');
  });

  it('should flush microtasks before returning', async () => {
    let thenRan = false;

    await fakeAsync(() => {
      resolvedPromise.then((_) => {
        thenRan = true;
      });
    })();

    expect(thenRan).toEqual(true);
  });

  it('should propagate the return value', () => {
    expect(fakeAsync(() => 'foo')()).toEqual('foo');
  });

  describe('Promise', () => {
    it('should run asynchronous code', fakeAsync(async () => {
      let thenRan = false;
      resolvedPromise.then((_) => {
        thenRan = true;
      });

      expect(thenRan).toEqual(false);

      await flushMicrotasks();
      expect(thenRan).toEqual(true);
    }));

    it('should run chained thens', fakeAsync(async () => {
      const log = new Log<number>();

      resolvedPromise.then((_) => log.add(1)).then((_) => log.add(2));

      expect(log.result()).toEqual('');

      await flushMicrotasks();
      expect(log.result()).toEqual('1; 2');
    }));

    it('should run Promise created in Promise', fakeAsync(async () => {
      const log = new Log<number>();

      resolvedPromise.then((_) => {
        log.add(1);
        resolvedPromise.then((_) => log.add(2));
      });

      expect(log.result()).toEqual('');

      await flushMicrotasks();
      expect(log.result()).toEqual('1; 2');
    }));

    xit('should complain if the test throws an exception during async calls', async () => {
      await expectAsync(
        fakeAsync(async () => {
          resolvedPromise.then((_) => {
            throw new Error('async');
          });
          await flushMicrotasks();
        })(),
      ).toBeRejected();
    });

    it('should complain if a test throws an exception', () => {
      expect(() => {
        return fakeAsync(() => {
          throw new Error('sync');
        })();
      }).toThrowError('sync');
    });
  });

  describe('timers', () => {
    it('should run queued zero duration timer on zero tick', fakeAsync(() => {
      let ran = false;
      setTimeout(() => {
        ran = true;
      }, 0);

      expect(ran).toEqual(false);

      tick();
      expect(ran).toEqual(true);
    }));

    it('should run queued timer after sufficient clock ticks', fakeAsync(() => {
      let ran = false;
      setTimeout(() => {
        ran = true;
      }, 10);

      tick(6);
      expect(ran).toEqual(false);

      tick(6);
      expect(ran).toEqual(true);
    }));

    it('should run new macro tasks created by timer callback', fakeAsync(() => {
      function nestedTimer(callback: () => any): void {
        setTimeout(() => setTimeout(() => callback()));
      }
      const callback = jasmine.createSpy('callback');
      nestedTimer(callback);
      expect(callback).not.toHaveBeenCalled();
      tick(1);
      expect(callback).toHaveBeenCalled();
    }));

    xit('should not queue nested timer on tick with processNewMacroTasksSynchronously=false', fakeAsync(() => {
      function nestedTimer(callback: () => any): void {
        setTimeout(() => setTimeout(() => callback()));
      }
      const callback = jasmine.createSpy('callback');
      nestedTimer(callback);
      expect(callback).not.toHaveBeenCalled();
      tick(0, {processNewMacroTasksSynchronously: false});
      expect(callback).not.toHaveBeenCalled();
      flush();
      expect(callback).toHaveBeenCalled();
    }));

    it('should throw an error if processNewMacroTasksSynchronously is set to true because it is not supported', () => {
      expect(() => {
        tick(0, {processNewMacroTasksSynchronously: true});
      }).toThrowError(
        'processNewMacroTasksSynchronously=true is not supported in zoneless fakeAsync',
      );
    });

    it('should run queued timer only once', fakeAsync(() => {
      let cycles = 0;
      setTimeout(() => {
        cycles++;
      }, 10);

      tick(10);
      expect(cycles).toEqual(1);

      tick(10);
      expect(cycles).toEqual(1);

      tick(10);
      expect(cycles).toEqual(1);
    }));

    it('should not run cancelled timer', fakeAsync(() => {
      let ran = false;
      const id = setTimeout(() => {
        ran = true;
      }, 10);
      clearTimeout(id);

      tick(10);
      expect(ran).toEqual(false);
    }));

    xit('should throw an error on dangling timers', () => {
      expect(() => {
        fakeAsync(
          () => {
            setTimeout(() => {}, 10);
          },
          {flush: false},
        )();
      }).toThrowError('1 timer(s) still in the queue.');
    });

    xit('should throw an error on dangling periodic timers', () => {
      expect(() => {
        fakeAsync(
          () => {
            setInterval(() => {}, 10);
          },
          {flush: false},
        )();
      }).toThrowError('1 periodic timer(s) still in the queue.');
    });

    it('should run periodic timers', fakeAsync(() => {
      let cycles = 0;
      const id = setInterval(() => {
        cycles++;
      }, 10);

      tick(10);
      expect(cycles).toEqual(1);

      tick(10);
      expect(cycles).toEqual(2);

      tick(10);
      expect(cycles).toEqual(3);
      clearInterval(id);
    }));

    it('should not run cancelled periodic timer', fakeAsync(() => {
      let ran = false;
      const id = setInterval(() => {
        ran = true;
      }, 10);
      clearInterval(id);

      tick(10);
      expect(ran).toEqual(false);
    }));

    it('should be able to cancel periodic timers from a callback', fakeAsync(() => {
      let cycles = 0;
      const id = setInterval(() => {
        cycles++;
        clearInterval(id);
      }, 10);

      tick(10);
      expect(cycles).toEqual(1);

      tick(10);
      expect(cycles).toEqual(1);
    }));

    xit('should clear periodic timers', fakeAsync(() => {
      let cycles = 0;
      setInterval(() => {
        cycles++;
      }, 10);

      tick(10);
      expect(cycles).toEqual(1);

      discardPeriodicTasks();

      // Tick once to clear out the timer which already started.
      tick(10);
      expect(cycles).toEqual(2);

      tick(10);
      // Nothing should change
      expect(cycles).toEqual(2);
    }));

    xit('should process microtasks before timers', fakeAsync(() => {
      const log = new Log();

      resolvedPromise.then((_) => log.add('microtask'));

      setTimeout(() => log.add('timer'), 9);

      const id = setInterval(() => log.add('periodic timer'), 10);

      expect(log.result()).toEqual('');

      tick(10);
      expect(log.result()).toEqual('microtask; timer; periodic timer');
      clearInterval(id);
    }));

    xit('should process micro-tasks created in timers before next timers', fakeAsync(() => {
      const log = new Log();

      resolvedPromise.then((_) => log.add('microtask'));

      setTimeout(() => {
        log.add('timer');
        resolvedPromise.then((_) => log.add('t microtask'));
      }, 9);

      const id = setInterval(() => {
        log.add('periodic timer');
        resolvedPromise.then((_) => log.add('pt microtask'));
      }, 10);

      tick(10);
      expect(log.result()).toEqual('microtask; timer; t microtask; periodic timer; pt microtask');

      tick(10);
      expect(log.result()).toEqual(
        'microtask; timer; t microtask; periodic timer; pt microtask; periodic timer; pt microtask',
      );
      clearInterval(id);
    }));

    xit('should flush tasks', fakeAsync(() => {
      let ran = false;
      setTimeout(() => {
        ran = true;
      }, 10);

      flush();
      expect(ran).toEqual(true);
    }));

    xit('should flush multiple tasks', fakeAsync(() => {
      let ran = false;
      let ran2 = false;
      setTimeout(() => {
        ran = true;
      }, 10);
      setTimeout(() => {
        ran2 = true;
      }, 30);

      let elapsed = flush();

      expect(ran).toEqual(true);
      expect(ran2).toEqual(true);
      expect(elapsed).toEqual(30);
    }));

    xit('should move periodic tasks', fakeAsync(() => {
      let ran = false;
      let count = 0;
      setInterval(() => {
        count++;
      }, 10);
      setTimeout(() => {
        ran = true;
      }, 35);

      let elapsed = flush();

      expect(count).toEqual(3);
      expect(ran).toEqual(true);
      expect(elapsed).toEqual(35);

      discardPeriodicTasks();
    }));
  });

  describe('outside of the fakeAsync zone', () => {
    it('calling flushMicrotasks should throw', async () => {
      expect(() => {
        flushMicrotasks();
      }).toThrowError('The code should be running in the fakeAsync zone to call this function');
    });

    it('calling tick should throw', () => {
      expect(() => {
        tick();
      }).toThrowError('The code should be running in the fakeAsync zone to call this function');
    });

    it('calling flush should throw', () => {
      expect(() => {
        flush();
      }).toThrowError('The code should be running in the fakeAsync zone to call this function');
    });

    it('calling discardPeriodicTasks should throw', () => {
      expect(() => {
        discardPeriodicTasks();
      }).toThrowError('The code should be running in the fakeAsync zone to call this function');
    });
  });
});

class SimpleFakeAsyncAdapter implements ɵFakeAsyncAdapter {
  static readonly _CURRENT_SIMPLE_FAKE_ASYNC_ADAPTER: unique symbol = Symbol(
    'currentSimpleFakeAsyncAdapter',
  );

  discardPeriodicTasks(): void {
    this._assertCurrent();
  }

  fakeAsync(fn: Function, _options?: {flush?: boolean}): (...args: any[]) => any {
    return (...args: any[]) => {
      this._install();
      try {
        return fn(...args);
      } finally {
        this._uninstall();
        this._setCurrent(undefined);
      }
    };
  }

  flush(): Promise<number> {
    const current = this._getCurrent();

    const start = current.now;

    this._tick();

    const elapsed = current.now - start;
    return this.flushMicrotasks().then(() => elapsed);
  }

  flushMicrotasks(): Promise<void> {
    const current = this._getCurrent();
    return new Promise<void>((resolve) => current.real.setTimeout(resolve, 0));
  }

  resetFakeAsyncZone(): void {}

  tick(millis: number, options?: {processNewMacroTasksSynchronously: boolean}): Promise<void> {
    if (options?.processNewMacroTasksSynchronously === true) {
      throw new Error(
        'processNewMacroTasksSynchronously=true is not supported in zoneless fakeAsync',
      );
    }

    this._assertCurrent();
    return this._tick(millis);
  }

  private _install() {
    if (this._maybeGetCurrent()) {
      throw new Error('fakeAsync() calls can not be nested');
    }
    const current: CurrentSimpleFakeAsync = {
      now: Date.now(),
      real: {setTimeout, setInterval, clearTimeout, clearInterval, dateNow: Date.now},
      taskQueue: [],
    };
    this._setCurrent(current);

    const fakes = {
      setTimeout: (fn: () => void, delay: number) => {
        current.taskQueue.push({time: Date.now() + delay, fn, ran: false});
        return current.taskQueue.length - 1;
      },
      clearTimeout: (id: number) => {
        current.taskQueue.splice(id, 1);
      },
      setInterval: ((fn: () => void, delay: number) => {
        const wrappedFn = () => {
          const task = current.taskQueue[index];
          fn();
          /* `clearInterval` was not called during the execution of the callback. */
          if (task === current.taskQueue[index]) {
            current.taskQueue[index] = {
              time: Date.now() + delay,
              fn: wrappedFn,
              ran: false,
            };
          }
        };
        const index = fakes.setTimeout(wrappedFn, delay);
        return index;
      }) as typeof setInterval,
      clearInterval: (id: number) => {
        fakes.clearTimeout(id);
      },
    };
    globalThis.setTimeout = fakes.setTimeout as typeof setTimeout;
    globalThis.clearTimeout = fakes.clearTimeout as typeof clearTimeout;
    globalThis.setInterval = fakes.setInterval as typeof setInterval;
    globalThis.clearInterval = fakes.clearInterval as typeof clearInterval;
    Date.now = () => current.now;
  }

  private _uninstall() {
    const current = this._getCurrent();
    globalThis.setTimeout = current.real.setTimeout;
    globalThis.clearTimeout = current.real.clearTimeout;
    globalThis.setInterval = current.real.setInterval;
    globalThis.clearInterval = current.real.clearInterval;
  }

  private _tick(millis?: number): Promise<void> {
    const current = this._getCurrent();

    const start = current.now;
    const end = millis !== undefined ? start + millis : Infinity;

    let task: CurrentSimpleFakeAsync['taskQueue'][number] | undefined;
    while ((task = this._getNextTaskToRun(end))) {
      current.now = task.time;
      task.ran = true;
      task.fn();
    }

    if (end !== undefined) {
      current.now = end;
    }

    return this.flushMicrotasks();
  }

  private _getNextTaskToRun(end?: number): CurrentSimpleFakeAsync['taskQueue'][number] | undefined {
    return [...this._getCurrent().taskQueue]
      .sort((a, b) => a.time - b.time)
      .filter((task) => {
        if (task.ran) {
          return false;
        }

        if (task.time < Date.now()) {
          return false;
        }

        if (end !== undefined && task.time > end) {
          return false;
        }

        return true;
      })[0];
  }

  private _assertCurrent(): void {
    this._getCurrent();
  }

  private _getCurrent(): CurrentSimpleFakeAsync {
    const current = this._maybeGetCurrent();
    if (current === undefined) {
      throw new Error('The code should be running in the fakeAsync zone to call this function');
    }
    return current;
  }

  private _maybeGetCurrent(): CurrentSimpleFakeAsync | undefined {
    return this._getGlobalThis()[SimpleFakeAsyncAdapter._CURRENT_SIMPLE_FAKE_ASYNC_ADAPTER];
  }

  private _setCurrent(current: CurrentSimpleFakeAsync | undefined): void {
    this._getGlobalThis()[SimpleFakeAsyncAdapter._CURRENT_SIMPLE_FAKE_ASYNC_ADAPTER] = current;
  }

  private _getGlobalThis() {
    return globalThis as unknown as {
      [SimpleFakeAsyncAdapter._CURRENT_SIMPLE_FAKE_ASYNC_ADAPTER]:
        | CurrentSimpleFakeAsync
        | undefined;
    };
  }
}

interface CurrentSimpleFakeAsync {
  now: number;
  real: {
    dateNow: () => number;
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
    clearTimeout: typeof clearTimeout;
    clearInterval: typeof clearInterval;
  };
  taskQueue: Array<{
    time: number;
    fn: () => void;
    ran: boolean;
  }>;
}

/**
 * I tried first with jasmine.clock() but it can't cover the same feature surface
 * as Vitest/sinonjs fake timers.
 *
 * TODO: Throw this away.
 */
class JasmineClockFakeAsyncAdapter implements ɵFakeAsyncAdapter {
  static readonly _CURRENT_JASMINE_CLOCK_FAKE_ASYNC_ADAPTER: unique symbol = Symbol(
    'currentJasmineClockFakeAsyncAdapter',
  );
  private readonly _clock = jasmine.clock();

  discardPeriodicTasks(): void {
    this._assertCurrentFakeZonelessAsync();
  }

  fakeAsync(fn: Function, _options?: {flush?: boolean}): (...args: any[]) => any {
    return (...args: any[]) => {
      const current = this._maybeGetCurrent();
      if (current) {
        throw new Error('fakeAsync() calls can not be nested');
      }

      this._setCurrent({realTimeout: setTimeout});
      this._clock.install();
      try {
        return fn(...args);
      } finally {
        this._clock.uninstall();
        this._setCurrent(undefined);
      }
    };
  }

  flush(): Promise<number> {
    this._assertCurrentFakeZonelessAsync();
    return this.flushMicrotasks().then(() => 0);
  }

  flushMicrotasks(): Promise<void> {
    const {realTimeout} = this._getCurrent();
    return new Promise<void>((resolve) => realTimeout(resolve, 0));
  }

  resetFakeAsyncZone(): void {}

  tick(millis: number, options?: {processNewMacroTasksSynchronously: boolean}): Promise<void> {
    if (options?.processNewMacroTasksSynchronously === true) {
      throw new Error(
        'processNewMacroTasksSynchronously=true is not supported in zoneless fakeAsync',
      );
    }

    this._assertCurrentFakeZonelessAsync();
    this._clock.tick(millis);
    return this.flushMicrotasks();
  }

  private _assertCurrentFakeZonelessAsync(): void {
    this._getCurrent();
  }

  private _getCurrent(): CurrentJasmineClockFakeAsync {
    const current = this._maybeGetCurrent();
    if (current === undefined) {
      throw new Error('The code should be running in the fakeAsync zone to call this function');
    }
    return current;
  }

  private _maybeGetCurrent(): CurrentJasmineClockFakeAsync | undefined {
    return this._getGlobalThis()[
      JasmineClockFakeAsyncAdapter._CURRENT_JASMINE_CLOCK_FAKE_ASYNC_ADAPTER
    ];
  }

  private _setCurrent(current: CurrentJasmineClockFakeAsync | undefined): void {
    this._getGlobalThis()[JasmineClockFakeAsyncAdapter._CURRENT_JASMINE_CLOCK_FAKE_ASYNC_ADAPTER] =
      current;
  }

  private _getGlobalThis() {
    return globalThis as unknown as {
      [JasmineClockFakeAsyncAdapter._CURRENT_JASMINE_CLOCK_FAKE_ASYNC_ADAPTER]:
        | CurrentJasmineClockFakeAsync
        | undefined;
    };
  }
}

interface CurrentJasmineClockFakeAsync {
  realTimeout: typeof setTimeout;
}
