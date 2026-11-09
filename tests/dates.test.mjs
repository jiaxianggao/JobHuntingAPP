import assert from "node:assert/strict";
import { test } from "node:test";
import { localDateKey, monthCells } from "../web/dates.js";

test("the date key uses the local day even when UTC is on a different day", () => {
  process.env.TZ = "America/Los_Angeles";
  const time = new Date("2026-11-10T02:00:00Z");
  assert.equal(time.getDate(), 9);
  assert.equal(localDateKey(time), "2026-11-09");
});

test("calendar cells preserve valid years below 100", () => {
  const month = new Date(0);
  month.setFullYear(99, 1, 1);
  const cells = monthCells(month).filter(Boolean);
  assert.equal(localDateKey(cells[0]), "0099-02-01");
  assert.equal(localDateKey(cells.at(-1)), "0099-02-28");
});
