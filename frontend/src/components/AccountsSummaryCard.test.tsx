import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountsSummaryCard } from "./AccountsSummaryCard";
import type { Account } from "../api/types";

function account(id: string, name: string, value: string): Account {
  return {
    id,
    connectionId: "c1",
    name,
    color: "#5b9bf0",
    typeKey: "checking",
    value,
    currency: "EUR",
    valueNative: null,
    lastSyncAt: null,
    sourceName: null,
    sourceLogo: null,
    fxMissing: false,
  };
}

const PRIVACY_OFF = { enabled: false, masked: false, toggle: () => {} };

const ACCOUNTS = [account("a", "Livret A", "750"), account("b", "PEA", "250"), account("c", "Empty", "0")];

describe("AccountsSummaryCard", () => {
  it("draws one segment per account that holds value", () => {
    render(<AccountsSummaryCard accounts={ACCOUNTS} privacy={PRIVACY_OFF} />);
    expect(screen.getByText("All accounts")).toBeInTheDocument();
    expect(screen.getByText(/1[\s\u202f,.]?000[.,]00/)).toBeInTheDocument();
    expect(screen.getAllByTestId("account-share")).toHaveLength(2);
  });

  it("leaves out an account of 1 % or less, too thin to see", () => {
    const accounts = [account("a", "Livret A", "990"), account("b", "Tiny", "10"), account("c", "Small", "11")];
    render(<AccountsSummaryCard accounts={accounts} privacy={PRIVACY_OFF} />);
    // 10 / 1011 is under 1 %; 11 / 1011 is just over.
    expect(screen.getAllByTestId("account-share")).toHaveLength(2);
  });

  it("shows the hovered account's name, share and value, and hides it on leave", () => {
    render(<AccountsSummaryCard accounts={ACCOUNTS} privacy={PRIVACY_OFF} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseMove(screen.getAllByTestId("account-share")[1]);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("PEA");
    expect(tooltip).toHaveTextContent(/PEA\s*·\s*25\s?%\s*·/);
    expect(tooltip).toHaveTextContent(/250[.,]00/);

    fireEvent.mouseLeave(screen.getAllByTestId("account-share")[1].parentElement!.parentElement!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
