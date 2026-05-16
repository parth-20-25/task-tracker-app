const multer = require("multer");
const path = require("path");
const { AppError } = require("./AppError");

const FIXTURE_REFERENCE_IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jfif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const MIME_TYPE_EXTENSIONS = {
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const SAFE_FILE_NAME_PATTERN = /[^a-zA-Z0-9._() -]/g;

function normalizeMimeType(mimeType) {
  return String(mimeType || "").trim().toLowerCase();
}

function getSafeFileExtension(file) {
  const mimeType = normalizeMimeType(file.mimetype);
  const originalExtension = path.extname(file.originalname || "").toLowerCase();

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return null;
  }

  if (originalExtension) {
    if (!ALLOWED_IMAGE_EXTENSIONS.has(originalExtension)) {
      return null;
    }

    return originalExtension;
  }

  return MIME_TYPE_EXTENSIONS[mimeType] || null;
}

function assertSafeFileExtension(file) {
  const extension = getSafeFileExtension(file);

  if (!extension) {
    throw new AppError(400, "Only JPEG, PNG, WEBP, GIF, BMP, HEIC, and HEIF images are allowed");
  }

  return extension;
}

function sanitizeOriginalFileName(originalName) {
  const baseName = path.basename(String(originalName || "fixture-reference-image"));
  const sanitizedName = baseName.replace(SAFE_FILE_NAME_PATTERN, "_").trim();

  if (sanitizedName) {
    return sanitizedName;
  }

  return "fixture-reference-image";
}

function handleReferenceImageUpload(req, res, next) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: FIXTURE_REFERENCE_IMAGE_MAX_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      try {
        assertSafeFileExtension(file);
        cb(null, true);
      } catch (error) {
        cb(error);
      }
    },
  });

  upload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(400, "Fixture reference image must be 10 MB or smaller"));
      return;
    }

    if (error instanceof AppError) {
      next(error);
      return;
    }

    next(new AppError(400, error.message || "Invalid fixture reference image upload"));
  });
}

module.exports = {
  FIXTURE_REFERENCE_IMAGE_MAX_SIZE_BYTES,
  sanitizeOriginalFileName,
  handleReferenceImageUpload,
};
