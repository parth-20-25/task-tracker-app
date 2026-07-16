import { describe, expect, it } from "vitest";

import {
  THREE_D_PROJECT_PROOF_OPTIONAL_KINDS,
  isProofOptionalThreeDProjectAdditionalTask,
  requiresTaskWorkProof,
} from "@/lib/taskProofPolicy";

describe("task proof policy", () => {
  it("marks the configured 3D project additional tasks as proof optional", () => {
    for (const additionalTaskKind of THREE_D_PROJECT_PROOF_OPTIONAL_KINDS) {
      const task = {
        task_type: "additional_design" as const,
        additional_task_kind: additionalTaskKind,
        design_team: "3D" as const,
        scope_type: "project" as const,
        fixture_id: null,
        proof_required: true,
      };

      expect(isProofOptionalThreeDProjectAdditionalTask(task)).toBe(true);
      expect(requiresTaskWorkProof(task)).toBe(false);
    }
  });

  it("keeps unrelated proof requirements intact", () => {
    expect(requiresTaskWorkProof({
      task_type: "department_workflow",
      workflow_stage: "3D Finish",
      proof_required: true,
    })).toBe(true);
    expect(requiresTaskWorkProof({
      task_type: "additional_design",
      additional_task_kind: "Print & Drafting Checking",
      design_team: "3D",
      scope_type: "project",
      fixture_id: null,
      proof_required: true,
    })).toBe(true);
    expect(requiresTaskWorkProof({
      task_type: "design_2d_completion",
      proof_required: true,
    })).toBe(false);
  });
});
