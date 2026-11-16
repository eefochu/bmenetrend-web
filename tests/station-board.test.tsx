import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider, PREFERENCES_KEY } from "../src/lib/preferences";
import { StopBoard } from "../src/components/app/transit-components";
import {
  DepartureBoardRow,
  NextDepartureHero,
} from "../src/components/app/departure-card";
import { clock, type Departure, type Stop } from "../src/lib/transit/model";

const originalFetch = globalThis.fetch;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  globalThis.fetch = originalFetch;
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const route = {
  id: "emma:1:S10",
  name: "S10",
  description: "",
  mode: "RAIL",
  color: "#00AFEF",
  textColor: "#fff",
};

test("station window selection snaps old values, persists and reloads the board", async () => {
  const window = new Window({ url: "http://localhost:3000" });
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const ranges: number[] = [];
  const epoch = Math.floor(Date.now() / 1000);
  globalThis.fetch = (async (_url, init) => {
    const variables = (
      JSON.parse(String(init?.body)) as { variables: { range: number } }
    ).variables;
    ranges.push(variables.range);
    return Response.json({
      data: {
        stop: {
          stoptimesWithoutPatterns: [10, 65, 250].map((minutes, index) => ({
            serviceDay: epoch,
            scheduledDeparture: minutes * 60,
            realtimeDeparture: minutes * 60 + 120,
            realtime: true,
            headsign: index === 2 ? "Későbbi célállomás" : "Budapest-Déli",
            trip: {
              gtfsId: `1:station-board-${index}`,
              route: { gtfsId: "1:S10", shortName: "S10", mode: "RAIL" },
            },
          })),
        },
      },
    });
  }) as typeof fetch;
  const stop: Stop = {
    id: "emma:1:station-board-test",
    rawId: "BKK_005501057_0",
    name: "Biatorbágy",
    position: { lat: 47.47, lon: 18.82 },
    platform: "2",
    source: "EMMA",
    mode: "RAIL",
    routes: [route],
  };
  // A window saved from the old 30p–5ó list snaps to the nearest current option (2ó).
  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ windowMinutes: 300 }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PreferencesProvider>
        <StopBoard stop={stop} onTrip={() => {}} />
      </PreferencesProvider>,
    );
  });
  await act(async () => {
    await sleep(250);
  });
  const group = container.querySelector('[role="radiogroup"]')!;
  // Android's connected toggle group: the chosen window is a plain pill, not a cookie.
  expect(group.classList.contains("connected-cookie")).toBe(false);
  expect(container.textContent).toContain("Kiválasztott megálló");
  expect(container.textContent).toContain("MÁV / GYSEV · Vonat");
  expect(
    group
      .querySelector('[aria-checked="true"]')!
      .classList.contains("connected-checked"),
  ).toBe(true);
  expect(
    [...group.querySelectorAll("button")].map((button) => button.textContent),
  ).toEqual(["10p", "20p", "30p", "1ó", "2ó"]);
  expect(container.querySelector(".departure-hero")).not.toBeNull();
  expect(container.textContent).not.toContain("Későbbi célállomás");
  const choices = group.querySelectorAll<HTMLButtonElement>("button");
  expect(choices[4]!.getAttribute("aria-checked")).toBe("true");
  await act(async () => {
    choices[1]!.click();
  });
  await act(async () => {
    await sleep(250);
  });
  expect(ranges).toEqual([7200, 1200]);
  expect(container.textContent).toContain("Budapest-Déli");
  expect(choices[1]!.getAttribute("aria-checked")).toBe("true");
  expect(
    JSON.parse(window.localStorage.getItem(PREFERENCES_KEY)!).windowMinutes,
  ).toBe(20);
  // Arrow keys use the same connected-selector behaviour as Android's single selection.
  await act(async () => {
    choices[1]!.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
      }) as unknown as Event,
    );
  });
  await act(async () => {
    await sleep(250);
  });
  expect(ranges.at(-1)).toBe(600);
  expect(choices[0]!.getAttribute("aria-checked")).toBe("true");
  // The only departure is 12 minutes away: outside a 10-minute window.
  expect(container.querySelector(".departure-hero")).toBeNull();
});

test("native board timing uses clock time after an hour and disables cancelled departures", () => {
  const now = Date.UTC(2026, 10, 15, 12);
  const row: Departure = {
    id: "test",
    stopId: "test",
    tripId: "test",
    destination: "Győr",
    route,
    expected: now + 65 * 60000,
    scheduled: now + 60 * 60000,
    live: true,
    cancelled: false,
    serviceDate: "",
    source: "EMMA",
  };
  const html = renderToStaticMarkup(
    <DepartureBoardRow departure={row} now={now} onSelect={() => {}} />,
  );
  expect(html).toContain(clock(row.expected));
  expect(html).not.toContain("65′");
  expect(html).toContain("sensors");
  // A delayed row's time turns to the error colour, as in DepartureBoardRow.
  expect(html).toContain("error-text");
  const hero = renderToStaticMarkup(
    <NextDepartureHero departure={row} now={now} onSelect={() => {}} />,
  );
  expect(hero).toContain("+5 perc");
  expect(hero).toContain(`Élő előrejelzés · ${clock(row.expected)}`);
  const cancelled = renderToStaticMarkup(
    <DepartureBoardRow
      departure={{ ...row, cancelled: true }}
      now={now}
      onSelect={() => {}}
    />,
  );
  expect(cancelled).toContain("disabled");
  expect(cancelled).toContain("Kimarad");
  expect(cancelled).not.toContain("sensors");
});
