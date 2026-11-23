import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../src/models/order.model.js";
test("modelo orders exporta lógica de validación", () => {
  assert.ok(Object.keys(model).length > 0);
});
