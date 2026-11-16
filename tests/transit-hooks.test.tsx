import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRemote } from "../src/lib/transit/hooks";
import type { Snapshot } from "../src/lib/transit/model";

const window = new Window({ url: "http://localhost" });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: window,
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: window.document,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: window.navigator,
});
Object.defineProperty(window.document, "hidden", {
  configurable: true,
  value: false,
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let root: Root | undefined;
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
});
function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root!.render(element);
    await sleep(10);
  });
}
const snapshot = (value: string): Snapshot<string> => ({
  value,
  at: Date.now(),
  incomplete: false,
  fallbackUnavailable: false,
});

test("superseded searches abort and late responses cannot replace the new query", async () => {
  let oldSignal: AbortSignal | undefined,
    finish: ((value: Snapshot<string>) => void) | undefined,
    shown = "";
  function Probe({ query }: { query: string }) {
    const resource = useRemote(query, async (signal) => {
      if (query === "old") {
        oldSignal = signal;
        return new Promise<Snapshot<string>>((resolve) => {
          finish = resolve;
        });
      }
      return snapshot("new result");
    });
    shown = resource.data?.value ?? "";
    return <span>{shown}</span>;
  }
  await mount(<Probe query="old" />);
  await act(async () => {
    await sleep(10);
  });
  await act(async () => {
    root!.render(<Probe query="new" />);
    await sleep(10);
  });
  await act(async () => {
    await sleep(10);
  });
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => {
    finish?.(snapshot("old result"));
    await sleep(10);
  });
  expect(shown).toBe("new result");
});

test("polling pauses in hidden documents and inactive screens, then resumes", async () => {
  let count = 0;
  function Probe({ active }: { active: boolean }) {
    useRemote(
      "poll",
      async () => {
        count++;
        return snapshot("data");
      },
      { active, interval: 20 },
    );
    return null;
  }
  await mount(<Probe active />);
  await act(async () => {
    await sleep(50);
  });
  expect(count).toBeGreaterThan(0);
  await act(async () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    await sleep(10);
  });
  const hidden = count;
  await act(async () => {
    await sleep(60);
  });
  expect(count).toBe(hidden);
  await act(async () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    await sleep(10);
  });
  expect(count).toBeGreaterThan(hidden);
  await act(async () => {
    root!.render(<Probe active={false} />);
    await sleep(10);
  });
  const inactive = count;
  await act(async () => {
    await sleep(60);
  });
  expect(count).toBe(inactive);
});

test("completed explicit planner results do not replan on visibility changes", async () => {
  let count = 0;
  function Probe() {
    useRemote(
      "plan",
      async () => {
        count++;
        return snapshot("plan");
      },
      { once: true },
    );
    return null;
  }
  await mount(<Probe />);
  await act(async () => {
    await sleep(10);
  });
  await act(async () => {
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    await sleep(10);
  });
  expect(count).toBe(1);
});

test("loading failures remain explicit and retry can recover without losing the selection", async () => {
  let attempts = 0,
    error = "",
    value = "",
    retry = () => {};
  function Probe() {
    const state = useRemote("retry-test", async () => {
      if (++attempts === 1) throw new Error("Temporary failure");
      return snapshot("Recovered");
    });
    error = state.error;
    value = state.data?.value ?? "";
    retry = state.retry;
    return null;
  }
  await mount(<Probe />);
  await act(async () => {
    await sleep(10);
  });
  expect(error).toBe("Temporary failure");
  await act(async () => {
    retry();
    await sleep(10);
  });
  await act(async () => {
    await sleep(10);
  });
  expect(value).toBe("Recovered");
  expect(error).toBe("");
});

test("map areas keep the previous area's data until the new area loads", async () => {
  let finish: ((value: Snapshot<string>) => void) | undefined;
  const shown: string[] = [];
  function Probe({ area }: { area: string }) {
    const resource = useRemote(
      area,
      async () =>
        area === "first"
          ? snapshot("first area")
          : new Promise<Snapshot<string>>((resolve) => {
              finish = resolve;
            }),
      { keepPrevious: true },
    );
    shown.push(resource.data?.value ?? "");
    return null;
  }
  await mount(<Probe area="first" />);
  await act(async () => {
    await sleep(10);
  });
  expect(shown.at(-1)).toBe("first area");
  await act(async () => {
    root!.render(<Probe area="second" />);
  });
  await act(async () => {
    await sleep(10);
  });
  // The second area is loading; its markers still show the first area.
  expect(finish).toBeDefined();
  expect(shown.at(-1)).toBe("first area");
  await act(async () => {
    finish?.(snapshot("second area"));
    await sleep(10);
  });
  expect(shown.at(-1)).toBe("second area");
  expect(shown.filter((value) => value === "").length).toBeLessThanOrEqual(1);
});
