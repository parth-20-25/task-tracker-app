const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCorsOptions,
  isOriginAllowed,
  parseAllowedOrigins,
} = require("./cors");

test("parseAllowedOrigins trims and drops empty entries", () => {
  assert.deepEqual(
    parseAllowedOrigins(" https://example.com/ , ,http://localhost:8080 "),
    ["https://example.com", "http://localhost:8080"],
  );
});

test("vercel preview deployments are allowed when the stable vercel domain is configured", () => {
  const corsOptions = buildCorsOptions("https://parc-control-system.vercel.app");
  let callbackError = null;
  let callbackValue = null;

  corsOptions.origin(
    "https://parc-control-system-9s1tipend-parths-projects-3440cd91.vercel.app",
    (error, value) => {
      callbackError = error;
      callbackValue = value;
    },
  );

  assert.equal(callbackError, null);
  assert.equal(callbackValue, true);
});

test("comma-separated exact origins continue to work", () => {
  const corsOptions = buildCorsOptions(
    "http://localhost:5173,http://localhost:3000,https://parc-control-system.vercel.app",
  );
  let callbackError = null;
  let callbackValue = null;

  corsOptions.origin("http://localhost:5173", (error, value) => {
    callbackError = error;
    callbackValue = value;
  });

  assert.equal(callbackError, null);
  assert.equal(callbackValue, true);
});

test("wildcard configuration allows arbitrary origins", () => {
  const corsOptions = buildCorsOptions("*");
  let callbackError = null;
  let callbackValue = null;

  corsOptions.origin("https://any-app.example.com", (error, value) => {
    callbackError = error;
    callbackValue = value;
  });

  assert.equal(callbackError, null);
  assert.equal(callbackValue, true);
});

test("non-matching origins are still rejected", () => {
  assert.equal(
    isOriginAllowed("https://another-project.vercel.app", ["https://parc-control-system.vercel.app"]),
    false,
  );
});
