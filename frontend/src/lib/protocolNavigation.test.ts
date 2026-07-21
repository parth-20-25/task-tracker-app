import { describe, expect, it } from "vitest";
import { getProtocolTargetPath } from "./protocolNavigation";

describe("getProtocolTargetPath", () => {
  it("accepts only an internal path from the PARC protocol", () => {
    expect(getProtocolTargetPath("web+parc://open?path=%2Ftasks%2F607")).toBe("/tasks/607");
    expect(getProtocolTargetPath("https://example.com/?path=%2Ftasks%2F607")).toBeNull();
    expect(getProtocolTargetPath("web+parc://open?path=https%3A%2F%2Fexample.com")).toBeNull();
    expect(getProtocolTargetPath("web+parc://open?path=%2F%2Fexample.com")).toBeNull();
    expect(getProtocolTargetPath("web+parc://open?path=javascript%3Aalert(1)")).toBeNull();
    expect(getProtocolTargetPath("web+parc://open?path=%2Ftasks%5C607")).toBeNull();
  });
});