const multer = require("multer");
const path = require("path");
const { AppError } = require("./AppError");

const DESIGN_EXCEL_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const DESIGN_EXCEL_MAX_SIZE_MB = 10;
const DESIGN_EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DESIGN_EXCEL_EXTENSION = ".xlsx";
const SAFE_FILE_NAME_PATTERN = /[^a-zA-Z0-9._() -]/g;

function sanitizeOriginalFileName(originalName) {
  const baseName = path.basename(String(originalName || "design-upload.xlsx"));
  const sanitizedName = baseName.replace(SAFE_FILE_NAME_PATTERN, "_").trim();

  if (!sanitizedName) {
    return "design-upload.xlsx";
  }

  if (path.extname(sanitizedName).toLowerCase() === DESIGN_EXCEL_EXTENSION) {
    return sanitizedName;
  }

  return `${sanitizedName}${DESIGN_EXCEL_EXTENSION}`;
}

function validateExcelFile(file) {
  const mimeType = String(file?.mimetype || "").trim().toLowerCase();
  const extension = path.extname(String(file?.originalname || "")).trim().toLowerCase();

  if (mimeType !== DESIGN_EXCEL_MIME_TYPE || extension !== DESIGN_EXCEL_EXTENSION) {
    throw new AppError(400, "Only .xlsx Excel files are allowed");
  }
}

const designExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DESIGN_EXCEL_MAX_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    try {
      validateExcelFile(file);
      cb(null, true);
    } catch (error) {
      cb(error);
    }
  },
});

function handleDesignExcelUpload(req, res, next) {
  designExcelUpload.single("file")(req, res, (error) => {
    if (!error) {
      if (!req.file) {
        next(new AppError(400, "No Excel file uploaded"));
        return;
      }

      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(400, `Excel file must be ${DESIGN_EXCEL_MAX_SIZE_MB} MB or smaller`));
      return;
    }

    if (error instanceof AppError) {
      next(error);
      return;
    }

    next(new AppError(400, error.message || "Invalid Excel upload"));
  });
}

module.exports = {
  DESIGN_EXCEL_MAX_SIZE_BYTES,
  DESIGN_EXCEL_MAX_SIZE_MB,
  DESIGN_EXCEL_EXTENSION,
  DESIGN_EXCEL_MIME_TYPE,
  handleDesignExcelUpload,
  sanitizeOriginalFileName,
};
