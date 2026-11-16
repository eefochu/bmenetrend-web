import { expect, test } from "bun:test";
import { railNumber } from "../src/lib/transit/emma";

test("EMMA rail badges ignore markup short names, like RailSupport.number", () => {
  expect(railNumber('MNR2007">8', "S150")).toBe("S150");
  expect(railNumber("<span>8</span>", "s 10")).toBe("S10");
  expect(railNumber("G44", "")).toBe("G44");
  expect(railNumber("", "ic Tokaj")).toBe("IC");
  expect(railNumber("", "")).toBe("?");
});
