const { generateUUID } = require("./uuid");
const { AppError } = require("./AppError");
const { env } = require("../config/env");

const DEFAULT_DESIGN_IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;

const MIME_TYPE_EXTENSIONS = {
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const EXTENSION_MIME_TYPES = {
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jfif: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function normalizeSupabaseUrl(value = env.supabase.url) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function getSupabaseStorageConfig() {
  return {
    url: normalizeSupabaseUrl(),
    serviceKey: String(env.supabase.serviceKey || "").trim(),
    bucket: String(env.supabase.storageBucket || "").trim(),
  };
}

function assertSupabaseStorageConfigured() {
  const config = getSupabaseStorageConfig();
  const missing = [];

  if (!config.url) missing.push("SUPABASE_URL");
  if (!config.serviceKey) missing.push("SUPABASE_SERVICE_KEY");
  if (!config.bucket) missing.push("SUPABASE_STORAGE_BUCKET");

  if (missing.length > 0) {
    throw new AppError(
      500,
      "Supabase Storage is not configured",
      `${missing.join(", ")} must be set before image uploads can be processed.`,
      "SUPABASE_STORAGE_NOT_CONFIGURED",
    );
  }

  return config;
}

function sanitizeStorageSegment(value, fallback) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

function normalizeExtension(value, mimeType) {
  const raw = String(value || "").trim().toLowerCase().replace(/^\./, "");

  if (raw && EXTENSION_MIME_TYPES[raw]) {
    return raw === "jpeg" ? "jpg" : raw;
  }

  const mimeExtension = MIME_TYPE_EXTENSIONS[String(mimeType || "").trim().toLowerCase()];
  if (mimeExtension) {
    return mimeExtension.replace(/^\./, "");
  }

  return "png";
}

function normalizeMimeType(value, extension) {
  const normalized = String(value || "").trim().toLowerCase();

  if (MIME_TYPE_EXTENSIONS[normalized]) {
    return normalized;
  }

  return EXTENSION_MIME_TYPES[normalizeExtension(extension, null)] || "image/png";
}

function encodeStoragePath(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildPublicStorageUrl(config, objectPath) {
  return `${config.url}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${encodeStoragePath(objectPath)}`;
}

async function uploadBufferToSupabaseStorage({
  buffer,
  mimeType,
  extension,
  folder,
  fileStem,
  maxSizeBytes = DEFAULT_DESIGN_IMAGE_MAX_SIZE_BYTES,
}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(400, "Image upload payload is empty");
  }

  if (buffer.length > maxSizeBytes) {
    throw new AppError(400, "Image file must be 10 MB or smaller");
  }

  const config = assertSupabaseStorageConfigured();
  const safeExtension = normalizeExtension(extension, mimeType);
  const safeMimeType = normalizeMimeType(mimeType, safeExtension);
  const safeFolder = String(folder || "")
    .split("/")
    .filter(Boolean)
    .map((segment, index) => sanitizeStorageSegment(segment, index === 0 ? "design" : "item"))
    .join("/");
  const safeFileStem = sanitizeStorageSegment(fileStem, "image");
  const objectPath = `${safeFolder || "design-images"}/${safeFileStem}-${generateUUID()}.${safeExtension}`;

  const response = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodeStoragePath(objectPath)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceKey}`,
        apikey: config.serviceKey,
        "Content-Type": safeMimeType,
        "Cache-Control": "31536000",
        "x-upsert": "false",
      },
      body: buffer,
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new AppError(
      502,
      "Failed to upload image to Supabase Storage",
      details || `Supabase Storage returned HTTP ${response.status}`,
      "SUPABASE_STORAGE_UPLOAD_FAILED",
    );
  }

  return {
    bucket: config.bucket,
    path: objectPath,
    publicUrl: buildPublicStorageUrl(config, objectPath),
  };
}

function bufferFromBase64Payload(contentBase64) {
  const normalized = String(contentBase64 || "").trim();
  if (!normalized) {
    throw new AppError(400, "Extracted image payload is empty");
  }

  return Buffer.from(normalized, "base64");
}

async function downloadStorageObjectBuffer(bucketName, objectPath) {
  const config = assertSupabaseStorageConfigured();
  const bucket = bucketName || config.bucket;
  const url = `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(objectPath)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.serviceKey}`,
      apikey: config.serviceKey,
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new AppError(
      502,
      "Failed to download object from Supabase Storage",
      details || `Supabase Storage returned HTTP ${response.status}`,
      "SUPABASE_STORAGE_DOWNLOAD_FAILED",
    );
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

async function deleteStorageObjects(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const config = assertSupabaseStorageConfigured();

  for (const entry of entries) {
    if (!entry?.path) {
      continue;
    }

    const bucket = entry.bucket || config.bucket;
    const response = await fetch(
      `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(entry.path)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${config.serviceKey}`,
          apikey: config.serviceKey,
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      const details = await response.text().catch(() => "");
      throw new AppError(
        502,
        "Failed to delete object from Supabase Storage",
        details || `Supabase Storage returned HTTP ${response.status}`,
        "SUPABASE_STORAGE_DELETE_FAILED",
      );
    }
  }
}

async function uploadExtractedDesignImageStaging({
  image,
  sessionId,
  fileInfo = {},
  row = {},
  slotName = "image_1_url",
  stagingPathsOut,
}) {
  const buffer = bufferFromBase64Payload(image?.content_base64);
  const sessionSeg = sanitizeStorageSegment(sessionId, "session");
  const projectCode = sanitizeStorageSegment(fileInfo.project_code, "unknown-project");
  const fixtureNo = sanitizeStorageSegment(row.fixture_no, `row-${row.excel_row || row.row_number || "unknown"}`);
  const slot = sanitizeStorageSegment(slotName.replace(/_url$/i, ""), "image");

  const uploaded = await uploadBufferToSupabaseStorage({
    buffer,
    mimeType: image?.mime_type,
    extension: image?.extension,
    folder: `design-ingestion-staging/${sessionSeg}/${projectCode}/${fixtureNo}`,
    fileStem: `${slot}-r${row.excel_row || row.row_number || "unknown"}`,
  });

  if (Array.isArray(stagingPathsOut)) {
    stagingPathsOut.push({ bucket: uploaded.bucket, path: uploaded.path });
  }

  return uploaded;
}

async function promoteStagedExtractedDesignImage({
  sourceBucket,
  sourcePath,
  fileInfo,
  row,
  slotName = "image_1_url",
}) {
  const { buffer, contentType } = await downloadStorageObjectBuffer(sourceBucket, sourcePath);
  const extensionFromPath = String(sourcePath || "").split(".").pop() || null;
  const projectCode = sanitizeStorageSegment(fileInfo.project_code, "unknown-project");
  const fixtureNo = sanitizeStorageSegment(row.fixture_no, `row-${row.excel_row || row.row_number || "unknown"}`);
  const slot = sanitizeStorageSegment(String(slotName).replace(/_url$/i, ""), "image");

  const uploaded = await uploadBufferToSupabaseStorage({
    buffer,
    mimeType: contentType,
    extension: extensionFromPath,
    folder: `design-excel/${projectCode}/${fixtureNo}`,
    fileStem: `${slot}-r${row.excel_row || row.row_number || "unknown"}`,
  });

  await deleteStorageObjects([{ bucket: sourceBucket, path: sourcePath }]);

  return uploaded;
}

async function uploadExtractedDesignImage({
  image,
  fileInfo = {},
  row = {},
  slotName = "image_1_url",
}) {
  const buffer = bufferFromBase64Payload(image?.content_base64);
  const projectCode = sanitizeStorageSegment(fileInfo.project_code, "unknown-project");
  const fixtureNo = sanitizeStorageSegment(row.fixture_no, `row-${row.excel_row || row.row_number || "unknown"}`);
  const slot = sanitizeStorageSegment(slotName.replace(/_url$/i, ""), "image");

  return uploadBufferToSupabaseStorage({
    buffer,
    mimeType: image?.mime_type,
    extension: image?.extension,
    folder: `design-excel/${projectCode}/${fixtureNo}`,
    fileStem: `${slot}-r${row.excel_row || row.row_number || "unknown"}`,
  });
}

async function uploadFixtureReferenceImageFile({ fixtureId, imageType, file }) {
  const extension = String(file?.originalname || "").split(".").pop();

  return uploadBufferToSupabaseStorage({
    buffer: file?.buffer,
    mimeType: file?.mimetype,
    extension,
    folder: `design-fixture-references/${sanitizeStorageSegment(fixtureId, "fixture")}`,
    fileStem: sanitizeStorageSegment(imageType, "reference-image"),
  });
}

module.exports = {
  DEFAULT_DESIGN_IMAGE_MAX_SIZE_BYTES,
  buildPublicStorageUrl,
  getSupabaseStorageConfig,
  normalizeExtension,
  normalizeMimeType,
  uploadBufferToSupabaseStorage,
  uploadExtractedDesignImage,
  uploadExtractedDesignImageStaging,
  promoteStagedExtractedDesignImage,
  deleteStorageObjects,
  downloadStorageObjectBuffer,
  uploadFixtureReferenceImageFile,
};
