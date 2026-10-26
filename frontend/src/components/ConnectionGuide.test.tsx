import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionGuide } from "./ConnectionGuide";

const powens = { key: "powens", displayName: "Powens", description: null };
const other = { key: "other", displayName: "Other", description: null };

describe("ConnectionGuide", () => {
  it("names the only provider and adds Powens's own points", () => {
    render(<ConnectionGuide providers={[powens]} />);
    expect(screen.getByText(/through Powens, a licensed provider/)).toBeInTheDocument();
    expect(screen.getByText("Your bank's official access first")).toBeInTheDocument();
    expect(screen.getByText("Then maybe your bank login")).toBeInTheDocument();
  });

  it("gives only the general point for a provider without its own", () => {
    render(<ConnectionGuide providers={[other]} />);
    expect(screen.getByText(/through Other, a licensed provider/)).toBeInTheDocument();
    expect(screen.queryByText("Then maybe your bank login")).not.toBeInTheDocument();
  });

  it("names no provider when there are several", () => {
    render(<ConnectionGuide providers={[powens, other]} />);
    expect(screen.getByText(/through a licensed provider/)).toBeInTheDocument();
    expect(screen.getByText("Then maybe your bank login")).toBeInTheDocument();
  });
});
