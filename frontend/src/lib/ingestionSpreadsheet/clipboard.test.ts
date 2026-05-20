import { describe, expect, it } from "vitest";
import {
  alignPasteToSelection,
  mapMatrixToEditableColumns,
  normalizeClipboardCell,
  parseClipboardMatrix,
} from "./clipboard";

describe("ingestionSpreadsheet clipboard", () => {
  it("normalizes whitespace and trailing dots", () => {
    expect(normalizeClipboardCell("  hello   world.  ")).toBe("hello world");
  });

  it("parses tab-separated paste matrix", () => {
    expect(parseClipboardMatrix("A\tB\nC\tD")).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("maps matrix columns from anchor without shifting", () => {
    const patches = mapMatrixToEditableColumns(
      [["PARC25119001", "Part"], ["PARC25119002", "Part 2"]],
      "fixture_no",
    );
    expect(patches[0]).toEqual({ fixture_no: "PARC25119001", part_name: "Part" });
    expect(patches[1]?.fixture_no).toBe("PARC25119002");
  });

  it("aligns overflow paste to selection size", () => {
    const aligned = alignPasteToSelection([["X", "Y", "Z"]], 2, 2);
    expect(aligned).toHaveLength(2);
    expect(aligned[0]).toHaveLength(2);
    expect(aligned[1][0]).toBe("X");
  });
});
