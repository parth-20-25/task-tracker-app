import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MorphLoader } from "@/components/ui/morph-loader";

describe("MorphLoader", () => {
  it("renders with the required accessibility attributes", () => {
    render(<MorphLoader />);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("maps numeric and string props to CSS variables safely", () => {
    const { rerender } = render(<MorphLoader size={48} color="#123456" duration="3s" />);

    const loader = screen.getByRole("status", { name: "Loading" });

    expect(loader).toHaveStyle({
      "--morph-loader-size": "48px",
      "--morph-loader-color": "#123456",
      "--morph-loader-duration": "3s",
    });

    rerender(<MorphLoader size="64px" />);

    expect(loader).toHaveStyle({
      "--morph-loader-size": "64px",
    });
  });
});
