import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HoldingModalHeader } from "./HoldingModalHeader";
import type { Holding } from "../api/types";

const holding = {
  ticker: "ESE",
  name: "BNP Easy S&P 500",
  logo: null,
  accountName: "Boursorama",
  accountColor: "#34d399",
  accountType: "pea",
  accountTypeLabel: "PEA",
} as Holding;

describe("HoldingModalHeader", () => {
  it("shows the holding's identity", () => {
    render(<HoldingModalHeader holding={holding} />);
    expect(screen.getByText("BNP Easy S&P 500")).toBeInTheDocument();
    // The account-type tag and the account name are two distinct elements, so
    // the fixture keeps them distinct strings — sharing one would make either
    // assertion pass on the other's element and prove nothing.
    expect(screen.getByText("PEA")).toBeInTheDocument();
    expect(screen.getByText("Boursorama")).toBeInTheDocument();
  });

  it("renders the caller's controls", () => {
    render(
      <HoldingModalHeader holding={holding}>
        <button type="button">Close</button>
      </HoldingModalHeader>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
