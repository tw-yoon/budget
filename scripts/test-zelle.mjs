import test from "node:test";
import assert from "node:assert/strict";
import { isP2p, isZelleName, parseZelleCounterparty } from "../src/lib/zelle.ts";

test("bank-feed Zelle payments are recognized", () => {
  assert.ok(isZelleName("Zelle Instant Pmt To Jane Doe Usb0wbt3kq9"));
  assert.ok(isZelleName("Ref Zelle Standard Pmt From John Roe 0923"));
  assert.ok(isZelleName("ZELLE INSTANT PMT TO JANE DOE"));
});

test("a memo that merely mentions Zelle is not a Zelle payment", () => {
  assert.ok(!isZelleName("Paid back via zelle pmt"));
  assert.ok(!isZelleName("Zelle"));
  assert.ok(!isZelleName("Zellers Pmt To Store"));
});

test("Venmo imports and Zelle payments are P2P; ordinary merchants aren't", () => {
  assert.ok(isP2p("VENMO", "Dinner"));
  assert.ok(isP2p("PLAID", "Zelle Instant Pmt To Jane Doe"));
  assert.ok(!isP2p("PLAID", "Trader Joe's"));
});

test("the counterparty drops the trailing bank reference", () => {
  assert.equal(parseZelleCounterparty("Zelle Instant Pmt To Jane Doe Usb0wbt3kq9"), "Jane Doe");
  assert.equal(parseZelleCounterparty("Ref Zelle Standard Pmt From John Roe 0923 Usbx1"), "John Roe");
});

test("direction words are matched case-insensitively", () => {
  assert.equal(parseZelleCounterparty("ZELLE INSTANT PMT FROM MARY ANN LEE"), "MARY ANN LEE");
});

test("a lone name is kept even if it looks like a reference", () => {
  assert.equal(parseZelleCounterparty("Zelle Pmt To 7Eleven"), "7Eleven");
});

test("an unparseable description falls back to 'Zelle'", () => {
  assert.equal(parseZelleCounterparty("Zelle Instant Pmt"), "Zelle");
  assert.equal(parseZelleCounterparty(""), "Zelle");
});
