import assert from "node:assert/strict";
import test from "node:test";
import { serializeCsv } from "../src/csv.js";

test("serializes ordinary CSV cells and escapes quotes", () => {
  assert.equal(
    serializeCsv([["Name", 'Coffee, "House"']]),
    '"Name","Coffee, ""House"""'
  );
});

test("neutralizes spreadsheet formulas after leading whitespace", () => {
  assert.equal(
    serializeCsv([["=1+1", " \t@SUM(A1:A2)", "-10"]]),
    `"'=1+1","' \t@SUM(A1:A2)","'-10"`
  );
});

test("preserves ordinary values and line breaks inside quoted cells", () => {
  assert.equal(serializeCsv([["Lunch\nCafe", "25.00"]]), '"Lunch\nCafe","25.00"');
});
