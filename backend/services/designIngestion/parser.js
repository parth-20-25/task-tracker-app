const { AppError } = require("../../lib/AppError");

const FIXTURE_NO_REGEX = /^PARC\d{8,}$/i;

const FIXTURE_TYPE_KEYWORDS = [
  "fixture",
  "checking",
  "welding",
  "robotic",
  "mig",
  "spot",
  "geo",
  "jig",
  "gauge",
  "gripper",
  "setting",
  "docking",
  "holding",
  "trimming",
  "assy",
  "assembly",
  "tool",
];

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z]/g, "")
    .replace(/\s+/g, "");
}

function normalizePastedCell(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "")
    .trim();
}

function splitRowIntoCells(row) {
  const normalizedRow = String(row || "").replace(/\r/g, "").trim();

  if (!normalizedRow) {
    return [];
  }

  if (normalizedRow.includes("\t")) {
    return normalizedRow
      .split("\t")
      .map(normalizePastedCell)
      .filter(Boolean);
  }

  if (/\s{2,}/.test(normalizedRow)) {
    return normalizedRow
      .split(/\s{2,}/)
      .map(normalizePastedCell)
      .filter(Boolean);
  }

  return [normalizePastedCell(normalizedRow)].filter(Boolean);
}

function extractFileInfo(rawRows) {
  const wbsRow = rawRows.find((row) => /\bWBS\b.*PARC/i.test(row));

  if (!wbsRow) {
    throw new AppError(400, "Could not find a valid WBS header in pasted data.");
  }

  const wbsText = normalizePastedCell(wbsRow).replace(/\t+/g, " ");
  const codeMatch = wbsText.match(/\bWBS\b\s*[-_]?\s*(PARC[A-Z0-9]+)(?=\s|[-_]|$)/i);

  if (!codeMatch) {
    throw new AppError(400, "Invalid WBS header format in pasted data.");
  }

  const project_code = normalizePastedCell(codeMatch[1]).toUpperCase();
  const remainder = normalizePastedCell(wbsText.slice(codeMatch.index + codeMatch[0].length))
    .replace(/^[-_\s]+/, "")
    .trim();
  const parts = remainder.includes("_")
    ? remainder.split(/\s*_\s*/).map((part) => normalizePastedCell(part).replace(/^[-_\s]+|[-_\s]+$/g, "")).filter(Boolean)
    : remainder.split(/\s+-\s+/).map((part) => normalizePastedCell(part).replace(/^[-_\s]+|[-_\s]+$/g, "")).filter(Boolean);

  if (parts.length < 2) {
    throw new AppError(400, "Invalid WBS header format in pasted data.");
  }

  const project_name = normalizePastedCell(parts[0].replace(/_+/g, " "));
  const company_name = normalizePastedCell(parts[1].replace(/_+/g, " "));

  if (!project_code || !project_name || !company_name) {
    throw new AppError(400, "Invalid WBS header format: project code, project name, and company name are required.");
  }

  return {
    project_code,
    project_name,
    project_name_display: project_name,
    company_name,
  };
}

function isFixtureNumber(value) {
  return FIXTURE_NO_REGEX.test(normalizePastedCell(value));
}

function normalizeFixtureNumber(value) {
  const normalized = normalizePastedCell(value).replace(/\s+/g, "").toUpperCase();
  return isFixtureNumber(normalized) ? normalized : "";
}

function isHeaderLikeCell(value) {
  const key = normalize(value);
  return (
    key === "sno"
    || key === "serialno"
    || key === "fixtureno"
    || key === "fixtureid"
    || key === "partname"
    || key === "fixturetype"
    || key === "qty"
    || key === "quantity"
    || key === "designer"
    || key === "partimage"
    || key === "fixtureimage"
  );
}

function isHeaderLikeRow(cells) {
  if (!cells.length) {
    return false;
  }

  const headerMatches = cells.filter(isHeaderLikeCell).length;
  return headerMatches >= 2;
}

function isImageOnlyCell(value) {
  const key = normalize(value);
  if (!key) {
    return false;
  }

  return key.includes("partimage")
    || key.includes("fixtureimage")
    || /^https?:\/\//i.test(String(value || "").trim())
    || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(String(value || "").trim());
}

function isFixtureTypeCell(value) {
  const normalized = normalizePastedCell(value).toLowerCase();
  return FIXTURE_TYPE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function isPositiveIntegerCell(value) {
  return /^\d+$/.test(normalizePastedCell(value));
}

function looksLikeMeaningfulText(value) {
  const text = normalizePastedCell(value);
  if (!text) {
    return false;
  }

  if (isFixtureNumber(text) || isPositiveIntegerCell(text) || isImageOnlyCell(text) || isHeaderLikeCell(text)) {
    return false;
  }

  return /[A-Za-z]/.test(text);
}

function isSerialNumberCell(value, index, fixtureIndex) {
  return index < fixtureIndex && isPositiveIntegerCell(value);
}

function isMetadataRow(cells) {
  if (!cells.length) {
    return true;
  }

  if (cells.some((cell) => /WBS\s*-/i.test(cell))) {
    return true;
  }

  if (isHeaderLikeRow(cells)) {
    return true;
  }

  return cells.every((cell) => isImageOnlyCell(cell) || cell === ".");
}

function isDataLikeRow(cells) {
  if (!cells.length || isMetadataRow(cells)) {
    return false;
  }

  const meaningfulCount = cells.filter((cell) => !isImageOnlyCell(cell) && cell !== ".").length;
  if (meaningfulCount < 2) {
    return false;
  }

  return cells.some((cell) => (
    isFixtureNumber(cell)
    || isFixtureTypeCell(cell)
    || isPositiveIntegerCell(cell)
  ));
}

function buildParsedRow(cells, rowNumber) {
  const fixtureIndex = cells.findIndex((cell) => isFixtureNumber(cell));
  const fixture_no = fixtureIndex >= 0 ? normalizeFixtureNumber(cells[fixtureIndex]) : "";

  const qtyCandidates = cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => isPositiveIntegerCell(cell) && !isSerialNumberCell(cell, index, fixtureIndex >= 0 ? fixtureIndex : Number.MAX_SAFE_INTEGER));
  const qtyCell = qtyCandidates.length > 0 ? qtyCandidates[qtyCandidates.length - 1] : null;

  const ignoredIndexes = new Set();
  if (fixtureIndex >= 0) ignoredIndexes.add(fixtureIndex);
  if (qtyCell) ignoredIndexes.add(qtyCell.index);

  const residualCells = cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => (
      !ignoredIndexes.has(index)
      && !isImageOnlyCell(cell)
      && !isSerialNumberCell(cell, index, fixtureIndex >= 0 ? fixtureIndex : Number.MAX_SAFE_INTEGER)
      && cell !== "."
      && !isHeaderLikeCell(cell)
    ));

  const fixtureTypeCandidate = residualCells.find(({ cell }) => isFixtureTypeCell(cell)) || null;
  if (fixtureTypeCandidate) {
    ignoredIndexes.add(fixtureTypeCandidate.index);
  }

  const remainingTextCells = residualCells.filter(({ index, cell }) => (
    !ignoredIndexes.has(index)
    && looksLikeMeaningfulText(cell)
  ));

  const partNameCandidate = remainingTextCells.length > 0
    ? remainingTextCells.reduce((best, current) => (
      current.cell.length > best.cell.length ? current : best
    ))
    : null;

  if (partNameCandidate) {
    ignoredIndexes.add(partNameCandidate.index);
  }

  const designerCandidate = residualCells.find(({ index, cell }) => (
    !ignoredIndexes.has(index)
    && looksLikeMeaningfulText(cell)
  )) || null;

  const hasRequiredStructure = Boolean(
    fixture_no
    && qtyCell?.cell
    && partNameCandidate?.cell
    && fixtureTypeCandidate?.cell
  );

  const hasPartialStructure = Boolean(
    fixture_no
    || qtyCell?.cell
    || partNameCandidate?.cell
    || fixtureTypeCandidate?.cell
  );

  return {
    row_number: rowNumber,
    fixture_no,
    part_name: partNameCandidate ? normalizePastedCell(partNameCandidate.cell) : "",
    fixture_type: fixtureTypeCandidate ? normalizePastedCell(fixtureTypeCandidate.cell) : "",
    designer: designerCandidate ? normalizePastedCell(designerCandidate.cell) : "",
    qty: qtyCell ? normalizePastedCell(qtyCell.cell) : "",
    image_1_url: null,
    image_2_url: null,
    parser_confidence: hasRequiredStructure ? "HIGH" : hasPartialStructure ? "MEDIUM" : "LOW",
    raw_data: {
      row_text: cells.join(" | "),
      cells,
    },
  };
}

function normalizeRawRowEntry(entry, index) {
  if (entry && typeof entry === "object") {
    return {
      text: String(entry.text || "").trim(),
      row_number: Number.isFinite(Number(entry.row_number)) ? Number(entry.row_number) : index + 1,
      excel_row: Number.isFinite(Number(entry.excel_row)) ? Number(entry.excel_row) : null,
      sheet_name: entry.sheet_name || null,
    };
  }

  return {
    text: String(entry || "").trim(),
    row_number: index + 1,
    excel_row: null,
    sheet_name: null,
  };
}

function parseTabularRows(rawEntries, emptyMessage) {
  const rawRows = (rawEntries || [])
    .map(normalizeRawRowEntry)
    .filter((entry) => entry.text);

  if (rawRows.length === 0) {
    throw new AppError(400, emptyMessage);
  }

  const file_info = extractFileInfo(rawRows.map((row) => row.text));
  const parsedRows = [];

  rawRows.forEach((row) => {
    const cells = splitRowIntoCells(row.text);

    if (!cells.length || isMetadataRow(cells)) {
      return;
    }

    if (!isDataLikeRow(cells) && !cells.some((cell) => isFixtureNumber(cell))) {
      return;
    }

    const parsedRow = buildParsedRow(cells, row.row_number);
    parsedRow.excel_row = row.excel_row;
    parsedRow.raw_data = {
      ...(parsedRow.raw_data || {}),
      excel_row: row.excel_row,
      sheet_name: row.sheet_name,
    };
    parsedRows.push(parsedRow);
  });

  if (parsedRows.length === 0) {
    throw new AppError(400, "No fixture-like rows were detected.");
  }

  return {
    file_info,
    parsedRows,
  };
}

function parsePasteData(text) {
  if (!text) {
    throw new AppError(400, "No paste data provided");
  }

  const normalizedText = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const rawRows = normalizedText.split("\n").map((row) => row.trim()).filter(Boolean);

  return parseTabularRows(rawRows, "Paste data is empty.");
}

module.exports = {
  FIXTURE_NO_REGEX,
  normalize,
  normalizePastedCell,
  parseTabularRows,
  parsePasteData,
};
