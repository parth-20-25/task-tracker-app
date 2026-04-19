const { generateUUID } = require("./uuid");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { AppError } = require("./AppError");

const TASK_PROOF_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const TASK_PROOF_MAX_SIZE_MB = 10;
const TASK_PROOF_UPLOAD_DIR = path.join(__dirname, "../uploads/task-proofs");
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

fs.mkdirSync(TASK_PROOF_UPLOAD_DIR, { recursive: true });

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

function buildStoredFileName(file) {
  const extension = getSafeFileExtension(file);

  if (!extension) {
    throw new AppError(400, "Only JPEG, PNG, WEBP, GIF, BMP, HEIC, and HEIF images are allowed");
  }

  return `${Date.now()}-${generateUUID()}${extension}`;
}

function sanitizeOriginalFileName(originalName) {
  const baseName = path.basename(String(originalName || "proof-image"));
  const sanitizedName = baseName.replace(SAFE_FILE_NAME_PATTERN, "_").trim();

  if (sanitizedName) {
    return sanitizedName;
  }

  return "proof-image";
}

const taskProofUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, TASK_PROOF_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      try {
        cb(null, buildStoredFileName(file));
      } catch (error) {
        cb(error);
      }
    },
  }),
  limits: { fileSize: TASK_PROOF_MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const mimeType = normalizeMimeType(file.mimetype);

    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      cb(new AppError(400, "Only JPEG, PNG, WEBP, GIF, BMP, HEIC, and HEIF images are allowed"));
      return;
    }

    cb(null, true);
  },
});

function handleTaskProofUpload(req, res, next) {
  taskProofUpload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(400, `Proof image must be ${TASK_PROOF_MAX_SIZE_MB} MB or smaller`));
      return;
    }

    if (error instanceof AppError) {
      next(error);
      return;
    }

    next(new AppError(400, error.message || "Invalid proof upload"));
  });
}

function buildTaskProofFileUrl(fileName) {
  return `/uploads/task-proofs/${fileName}`;
}

async function removeStoredTaskProof(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

module.exports = {
  TASK_PROOF_MAX_SIZE_BYTES,
  TASK_PROOF_MAX_SIZE_MB,
  buildTaskProofFileUrl,
  handleTaskProofUpload,
  removeStoredTaskProof,
  sanitizeOriginalFileName,
};
