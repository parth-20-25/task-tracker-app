const XLSX = require("xlsx");
const { AppError } = require("../../lib/AppError");
const {
  collapseWhitespace,
  normalizeBoolean,
} = require("./normalization");

const TEMPLATE_HEADERS = [
  "Fixture No",
  "Part Name",
  "Fixture Type",
  "Qty",
  "Reference Image",
  "Remarks",
  "Outsourced",
  "Vendor",
];

const DATA_HEADERS = [
  "fixture_no",
  "part_name",
  "fixture_type",
  "qty",
  "reference_image_url",
  "remark",
  "is_outsourced",
  "vendor_name",
];

const HEADER_ALIASES = {
  status: "status",
  fixtureno: "fixture_no",
  fixture: "fixture_no",
  partname: "part_name",
  part: "part_name",
  fixturetype: "fixture_type",
  type: "fixture_type",
  remark: "remark",
  remarks: "remark",
  qty: "qty",
  quantity: "qty",
  outsourced: "is_outsourced",
  outsource: "is_outsourced",
  vendor: "vendor_name",
  vendorname: "vendor_name",
  image1: "reference_image_url",
  referenceimage: "reference_image_url",
  refimage: "reference_image_url",
  partimage: "reference_image_url",
  fixtureimage: "reference_image_url",
  validationstate: "validation_state",
};

function headerKey(value) {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cellText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return collapseWhitespace(value);
}

function rowIsEmpty(row) {
  return row.every((cell) => !cellText(cell));
}

function detectHeaderRow(rows) {
  let best = { index: -1, map: new Map(), hits: 0 };

  rows.slice(0, 30).forEach((row, index) => {
    const map = new Map();
    let hits = 0;
    row.forEach((cell, columnIndex) => {
      const alias = HEADER_ALIASES[headerKey(cell)];
      if (alias) {
        map.set(alias, columnIndex);
        hits += 1;
      }
    });

    if (hits > best.hits) {
      best = { index, map, hits };
    }
  });

  return best.hits >= 3 ? best : { index: -1, map: new Map(), hits: 0 };
}

function mapRowWithHeader(row, rowNumber, headerMap) {
  return {
    row_id: `excel-${rowNumber}`,
    row_number: rowNumber,
    fixture_no: cellText(row[headerMap.get("fixture_no")]),
    part_name: cellText(row[headerMap.get("part_name")]),
    fixture_type: cellText(row[headerMap.get("fixture_type")]),
    qty: cellText(row[headerMap.get("qty")]),
    reference_image_url: cellText(row[headerMap.get("reference_image_url")]),
    remark: cellText(row[headerMap.get("remark")]),
    is_outsourced: normalizeBoolean(row[headerMap.get("is_outsourced")]),
    vendor_name: cellText(row[headerMap.get("vendor_name")]),
  };
}

function mapRowByTemplateOrder(row, rowNumber) {
  return {
    row_id: `excel-${rowNumber}`,
    row_number: rowNumber,
    fixture_no: cellText(row[0]),
    part_name: cellText(row[1]),
    fixture_type: cellText(row[2]),
    qty: cellText(row[3]),
    reference_image_url: cellText(row[4]),
    remark: cellText(row[5]),
    is_outsourced: normalizeBoolean(row[6]),
    vendor_name: cellText(row[7]),
  };
}

function parseNativeWorkbook(file) {
  if (!file?.buffer) {
    throw new AppError(400, "No native workbook uploaded");
  }

  const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new AppError(400, "Workbook does not contain a worksheet");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  const rows = matrix.filter((row) => Array.isArray(row));
  const header = detectHeaderRow(rows);
  const dataRows = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (rowIsEmpty(row)) {
      return;
    }

    if (header.index === index) {
      return;
    }

    const mapped = header.index >= 0
      ? mapRowWithHeader(row, rowNumber, header.map)
      : mapRowByTemplateOrder(row, rowNumber);

    if (DATA_HEADERS.every((key) => !cellText(mapped[key]))) {
      return;
    }

    dataRows.push(mapped);
  });

  return {
    sheet_name: sheetName,
    rows: dataRows,
  };
}

function parseNativeClipboard(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    throw new AppError(400, "Clipboard data is empty");
  }

  const matrix = normalized
    .split("\n")
    .map((line) => line.split("\t").map(cellText));

  const header = detectHeaderRow(matrix);
  const rows = [];

  matrix.forEach((row, index) => {
    const rowNumber = index + 1;
    if (rowIsEmpty(row) || header.index === index) {
      return;
    }

    rows.push(
      header.index >= 0
        ? mapRowWithHeader(row, rowNumber, header.map)
        : mapRowByTemplateOrder(row, rowNumber),
    );
  });

  return rows;
}

function buildNativeTemplateWorkbook() {
  const worksheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ["PARC001", "RH Bracket", "Checking Fixture", "1", "paste/upload one reference image in workspace", "Use production fixture remarks here", "FALSE", ""],
  ]);
  const notes = XLSX.utils.aoa_to_sheet([
    ["Native Fixture Ingestion Template"],
    ["Project identity is entered in the workspace, not in this sheet."],
    ["Required columns: Fixture No, Part Name, Fixture Type, Qty."],
    ["Reference Image: paste, drag-drop, or upload one image per fixture row in the workspace. URLs are accepted when already hosted."],
    ["Outsourced and Vendor are optional row-level fields; Vendor is required only when Outsourced is TRUE."],
  ]);
  worksheet["!cols"] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 24 },
    { wch: 10 },
    { wch: 28 },
    { wch: 28 },
    { wch: 14 },
    { wch: 22 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Native Ingestion");
  XLSX.utils.book_append_sheet(workbook, notes, "Instructions");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

module.exports = {
  TEMPLATE_HEADERS,
  buildNativeTemplateWorkbook,
  parseNativeClipboard,
  parseNativeWorkbook,
};
