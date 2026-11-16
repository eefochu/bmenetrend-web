import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DataStatus } from "../src/components/app/transit-components";

test("direct and Worker MÁV failures produce a single availability warning", () => {
  const direct =
    "A MÁV/EMMA adatai ebben a böngészőben nem érhetők el. A BKK adatai továbbra is használhatók.";
  const html = renderToStaticMarkup(
    <DataStatus error={direct} fallbackUnavailable at={Date.now()} />,
  );
  expect((html.match(/A BKK adatai/g) ?? []).length).toBe(1);
  expect(html).toContain(direct);
});
