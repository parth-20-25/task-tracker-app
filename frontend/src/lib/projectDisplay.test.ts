import { describe, expect, it } from "vitest";
import { formatDesignProjectLabel, formatProjectNumber } from "./projectDisplay";

describe("project display helpers", () => {
  it("removes stray leading separators without dropping valid internal project-code hyphens", () => {
    expect(formatProjectNumber({ project_no: " - PARC2600M005-J1D " })).toBe("PARC2600M005-J1D");
    expect(formatDesignProjectLabel({
      project_no: "- PARC2600M005-J1D",
      project_name: "- RAQ01584 Saree Guard Welding Line",
    })).toBe("PARC2600M005-J1D - RAQ01584 Saree Guard Welding Line");
  });
});
