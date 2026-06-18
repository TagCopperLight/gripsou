import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EnabledProvider } from "../api/types";

const providers: EnabledProvider[] = [
  { key: "powens", displayName: "Powens", description: "Banking aggregator" },
];
const initMutate = vi.fn();
const init = { mutate: initMutate, isPending: false, isError: false };

vi.mock("../api/hooks", () => ({
  useEnabledProviders: () => ({ data: providers, isLoading: false, isError: false }),
  useInitConnection: () => init,
}));

import { AddConnectionModal } from "./AddConnectionModal";

describe("AddConnectionModal", () => {
  beforeEach(() => initMutate.mockReset());

  it("renders provider cards", () => {
    render(<AddConnectionModal onClose={() => {}} />);
    expect(screen.getByText("Powens")).toBeInTheDocument();
    expect(screen.getByText("Banking aggregator")).toBeInTheDocument();
  });

  it("connect button is disabled until a provider is selected", () => {
    render(<AddConnectionModal onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /connect/i })).toBeDisabled();
  });

  it("selecting a provider enables the connect button and calls mutate on click", () => {
    render(<AddConnectionModal onClose={() => {}} />);
    fireEvent.click(screen.getByText("Powens"));
    const btn = screen.getByRole("button", { name: /connect/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(initMutate).toHaveBeenCalledWith("powens", expect.any(Object));
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<AddConnectionModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
