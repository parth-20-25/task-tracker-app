import { describe, expect, it } from "vitest";
import {
  getFixtureCurrentRevisionLabel,
  isFixtureActiveOutsourcedSection,
  isFixtureCurrentStageOutsourced,
} from "@/lib/outsourceWorkflowDisplay";
import type { DesignFixtureOption } from "@/types";

function fixture(overrides: Partial<DesignFixtureOption>): DesignFixtureOption {
  return {
    fixture_id: "fixture-1",
    project_id: "project-1",
    department_id: "dept-1",
    fixture_no: "F-001",
    part_name: "Fixture",
    fixture_type: "Checking",
    qty: 1,
    is_outsourced: true,
    outsourced_stages: [],
    outsource_status: "outsourced",
    revision_no: 0,
    is_legacy_workflow: false,
    is_workflow_complete: false,
    workflow_stage: "Concept",
    workflow_stage_label: "Concept",
    workflow_stage_order: 1,
    workflow_stage_version: 0,
    workflow_revision_code: "CON 00",
    workflow_status: "PENDING",
    operational_state: "UNASSIGNED",
    ...overrides,
  };
}

describe("outsource workflow display helpers", () => {
  it("keeps future outsourced stages out of the Outsourced section and displays only the real current revision", () => {
    const conceptBeforeOutsourced3d = fixture({
      outsourced_stages: ["3D"],
      workflow_stage: "Concept",
      workflow_stage_label: "Concept",
      workflow_revision_code: "CON 00",
    });

    expect(getFixtureCurrentRevisionLabel(conceptBeforeOutsourced3d)).toBe("CON00");
    expect(isFixtureCurrentStageOutsourced(conceptBeforeOutsourced3d)).toBe(false);
    expect(isFixtureActiveOutsourcedSection(conceptBeforeOutsourced3d)).toBe(false);
  });

  it("treats DAP as internal even when surrounding stages are outsourced", () => {
    const internalDap = fixture({
      outsourced_stages: ["Concept", "3D"],
      workflow_stage: "DAP",
      workflow_stage_label: "DAP",
      workflow_revision_code: "DAP 00",
    });

    expect(getFixtureCurrentRevisionLabel(internalDap)).toBe("DAP00");
    expect(isFixtureCurrentStageOutsourced(internalDap)).toBe(false);
    expect(isFixtureActiveOutsourcedSection(internalDap)).toBe(true);
  });

  it("moves out of Outsourced after Concept completes when the next stage is not outsourced", () => {
    const onlyConceptOutsourced = fixture({
      outsourced_stages: ["Concept"],
      workflow_stage: "DAP",
      workflow_stage_label: "DAP",
      workflow_revision_code: "DAP 00",
    });

    expect(isFixtureCurrentStageOutsourced(onlyConceptOutsourced)).toBe(false);
    expect(isFixtureActiveOutsourcedSection(onlyConceptOutsourced)).toBe(false);
  });

  it("puts the fixture in Outsourced when the current stage or immediate next stage is selected for outsourcing", () => {
    const active3d = fixture({
      outsourced_stages: ["3D"],
      workflow_stage: "3D Finish",
      workflow_stage_label: "3D Finish",
      workflow_revision_code: "3D 00",
    });

    const active2d = fixture({
      outsourced_stages: ["2D"],
      workflow_stage: "2D Finish",
      workflow_stage_label: "2D Finish",
      workflow_revision_code: "2D 00",
    });

    const inHouse3dBeforeOutsourced2d = fixture({
      outsourced_stages: ["2D"],
      workflow_stage: "3D Finish",
      workflow_stage_label: "3D Finish",
      workflow_revision_code: "3D 00",
    });

    expect(getFixtureCurrentRevisionLabel(active3d)).toBe("3D00");
    expect(isFixtureActiveOutsourcedSection(active3d)).toBe(true);
    expect(getFixtureCurrentRevisionLabel(active2d)).toBe("2D00");
    expect(isFixtureActiveOutsourcedSection(active2d)).toBe(true);
    expect(isFixtureCurrentStageOutsourced(inHouse3dBeforeOutsourced2d)).toBe(false);
    expect(isFixtureActiveOutsourcedSection(inHouse3dBeforeOutsourced2d)).toBe(true);
  });

  it("keeps completed fixtures out of Outsourced even if outsource stages remain selected", () => {
    const completed = fixture({
      outsourced_stages: ["2D"],
      workflow_stage: "Release",
      workflow_stage_label: "Release",
      is_workflow_complete: true,
    });

    expect(isFixtureCurrentStageOutsourced(completed)).toBe(false);
    expect(isFixtureActiveOutsourcedSection(completed)).toBe(false);
  });
});
