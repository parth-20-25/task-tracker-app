const assert = require("node:assert/strict");
const http = require("node:http");

const { env } = require("../config/env");
const {
  buildPublicStorageUrl,
  normalizeExtension,
  normalizeMimeType,
  uploadExtractedDesignImage,
} = require("../lib/supabaseStorage");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function run() {
  runTest("normalizes image extension and mime type safely", () => {
    assert.equal(normalizeExtension("jpeg", "image/jpeg"), "jpg");
    assert.equal(normalizeExtension("", "image/webp"), "webp");
    assert.equal(normalizeMimeType("", "png"), "image/png");
  });

  runTest("builds stable public Supabase object URL", () => {
    const url = buildPublicStorageUrl(
      { url: "https://example.supabase.co", bucket: "design-images" },
      "design-excel/PARC2600M001/PARC26001001/image 1.png",
    );

    assert.equal(
      url,
      "https://example.supabase.co/storage/v1/object/public/design-images/design-excel/PARC2600M001/PARC26001001/image%201.png",
    );
  });

  await runAsyncTest("uploads extracted image bytes through Supabase Storage API", async () => {
    const requests = [];
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks),
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
      });
    });
    const address = await listen(server);
    const previousSupabaseConfig = { ...env.supabase };

    env.supabase.url = `http://127.0.0.1:${address.port}`;
    env.supabase.serviceKey = "service-key";
    env.supabase.storageBucket = "design-images";

    try {
      const uploaded = await uploadExtractedDesignImage({
        image: {
          content_base64: Buffer.from("real-image-bytes").toString("base64"),
          mime_type: "image/png",
          extension: "png",
        },
        fileInfo: { project_code: "PARC2600M001" },
        row: { fixture_no: "FIX 01", excel_row: 4 },
      });

      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, "POST");
      assert.match(
        requests[0].url,
        /^\/storage\/v1\/object\/design-images\/design-excel\/PARC2600M001\/FIX-01\/image_1-r4-[a-f0-9-]+\.png$/,
      );
      assert.equal(requests[0].headers.authorization, "Bearer service-key");
      assert.equal(requests[0].headers.apikey, "service-key");
      assert.equal(requests[0].headers["content-type"], "image/png");
      assert.equal(requests[0].body.toString(), "real-image-bytes");
      assert.equal(uploaded.bucket, "design-images");
      assert.match(
        uploaded.publicUrl,
        /^http:\/\/127\.0\.0\.1:\d+\/storage\/v1\/object\/public\/design-images\/design-excel\/PARC2600M001\/FIX-01\/image_1-r4-[a-f0-9-]+\.png$/,
      );
    } finally {
      Object.assign(env.supabase, previousSupabaseConfig);
      await close(server);
    }
  });

  console.log("supabase storage checks passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
