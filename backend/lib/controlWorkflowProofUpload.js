const fs = require("fs/promises");
const multer = require("multer");
const path = require("path");
const { AppError } = require("./AppError");
const { ensureDirectorySync, getControlWorkflowProofUploadDir } = require("./runtimePaths");
const { sanitizeOriginalFileName } = require("./taskProofUpload");
const { generateUUID } = require("./uuid");

const CONTROL_WORKFLOW_PROOF_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const CONTROL_WORKFLOW_PROOF_MAX_SIZE_MB = 10;
const CONTROL_WORKFLOW_PROOF_DIR = getControlWorkflowProofUploadDir();
const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".pdf", "application/pdf"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".dwg", "application/acad"],
  [".dxf", "application/dxf"],
  [".igs", "model/iges"],
  [".iges", "model/iges"],
  [".step", "model/step"],
  [".stp", "model/step"],
  [".csv", "text/csv"],
  [".txt", "text/plain"],
  [".zip", "application/zip"],
  [".rar", "application/vnd.rar"],
]);

ensureDirectorySync(CONTROL_WORKFLOW_PROOF_DIR);

function startsWith(buffer, bytes) {
  return buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
}

function isText(buffer) {
  return !buffer.subarray(0, 4096).includes(0);
}

function inspectControlWorkflowProof(file) {
  const originalName = sanitizeOriginalFileName(file?.originalname);
  const extension = path.extname(originalName).toLowerCase();
  const mimeType = MIME_BY_EXTENSION.get(extension);
  const buffer = file?.buffer;
  if (!mimeType || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(400, "Unsupported or empty work-proof file");
  }

  const head = buffer.subarray(0, 4096).toString("latin1");
  const zip = startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]);
  const ole = startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const valid = extension === ".png" ? startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : [".jpg", ".jpeg"].includes(extension) ? startsWith(buffer, [0xff, 0xd8, 0xff])
      : extension === ".pdf" ? head.startsWith("%PDF-")
        : [".doc", ".xls"].includes(extension) ? ole
          : extension === ".docx" ? zip && buffer.includes(Buffer.from("word/"))
            : extension === ".xlsx" ? zip && buffer.includes(Buffer.from("xl/"))
              : extension === ".zip" ? zip
                : extension === ".rar" ? startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])
                  : extension === ".dwg" ? head.startsWith("AC10")
                    : extension === ".dxf" ? isText(buffer) && /SECTION|HEADER|ENTITIES/i.test(head)
                      : [".step", ".stp"].includes(extension) ? isText(buffer) && /ISO-10303-21/i.test(head)
                        : [".igs", ".iges"].includes(extension) ? isText(buffer) && /IGES|S\s*\d+/i.test(head)
                          : isText(buffer);

  if (!valid) {
    throw new AppError(400, "File content does not match the selected work-proof type");
  }

  return { extension, mimeType, originalName };
}

const controlWorkflowProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONTROL_WORKFLOW_PROOF_MAX_SIZE_BYTES },
});

function handleControlWorkflowProofUpload(req, res, next) {
  controlWorkflowProofUpload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return next(new AppError(400, `Work-proof file must be ${CONTROL_WORKFLOW_PROOF_MAX_SIZE_MB} MB or smaller`));
    }
    return next(new AppError(400, error.message || "Invalid work-proof upload"));
  });
}

async function persistControlWorkflowProofFile(file) {
  const inspected = inspectControlWorkflowProof(file);
  const storageKey = `${Date.now()}-${generateUUID()}${inspected.extension}`;
  const filePath = path.join(CONTROL_WORKFLOW_PROOF_DIR, storageKey);
  await fs.writeFile(filePath, file.buffer, { flag: "wx" });
  return { ...inspected, storageKey, filePath };
}

function resolveControlWorkflowProofPath(storageKey) {
  const resolved = path.resolve(CONTROL_WORKFLOW_PROOF_DIR, String(storageKey || ""));
  const relative = path.relative(CONTROL_WORKFLOW_PROOF_DIR, resolved);
  if (!storageKey || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError(400, "Invalid work-proof storage key");
  }
  return resolved;
}

async function removeControlWorkflowProofFile(storageKey) {
  try {
    await fs.unlink(resolveControlWorkflowProofPath(storageKey));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  CONTROL_WORKFLOW_PROOF_MAX_SIZE_MB,
  handleControlWorkflowProofUpload,
  inspectControlWorkflowProof,
  persistControlWorkflowProofFile,
  removeControlWorkflowProofFile,
  resolveControlWorkflowProofPath,
};
