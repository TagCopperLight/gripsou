import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionGuide } from "./ConnectionGuide";

describe("ConnectionGuide", () => {
  it("adds only the points of the providers that are enabled", () => {
    render(<ConnectionGuide providers={[{ key: "other", displayName: "Other", description: null }]} />);
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByText("Then maybe your bank login")).not.toBeInTheDocument();
  });
});
