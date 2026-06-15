import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountCard } from "./AccountCard";
import type { Account } from "../api/types";

const ACCOUNT: Account = {
  id: "a1",
  name: "Compte Courant",
  color: "#6ea8fe",
  typeLabel: "Checking",
  value: "12480.30",
  lastSyncAt: null,
};

describe("AccountCard", () => {
  it("renders name, type label, proportion and sync state", () => {
    render(<AccountCard account={ACCOUNT} proportion={0.142} />);
    expect(screen.getByText("Compte Courant")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText(/14[.,]2/)).toBeInTheDocument();
    expect(screen.getByText("Never synced")).toBeInTheDocument();
  });
});
