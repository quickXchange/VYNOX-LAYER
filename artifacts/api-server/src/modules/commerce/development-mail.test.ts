import test from "node:test";
import assert from "node:assert/strict";
import { developmentMailCapture } from "./development-mail";

test("mail sink fails closed outside explicit Development", () => {
  const keys = ["QXLAYER_DEVELOPMENT_MAIL_CAPTURE", "NODE_ENV", "QXLAYER_EXTERNAL_ENVIRONMENT", "QXLAYER_AUTH_PROVIDER"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.QXLAYER_DEVELOPMENT_MAIL_CAPTURE = "true";
    process.env.NODE_ENV = "development";
    process.env.QXLAYER_EXTERNAL_ENVIRONMENT = "development";
    process.env.QXLAYER_AUTH_PROVIDER = "supabase";
    assert.equal(developmentMailCapture(), true);
    process.env.QXLAYER_EXTERNAL_ENVIRONMENT = "production";
    assert.throws(developmentMailCapture);
    process.env.QXLAYER_EXTERNAL_ENVIRONMENT = "development";
    process.env.NODE_ENV = "production";
    assert.throws(developmentMailCapture);
    process.env.QXLAYER_DEVELOPMENT_MAIL_CAPTURE = "false";
    assert.equal(developmentMailCapture(), false);
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
