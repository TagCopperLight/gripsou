import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ProviderGroup } from "../../api/types";

const connections: { data: ProviderGroup[]; isLoading: boolean; isError: boolean; refetch: () => void } = {
  data: [
    {
      providerKey: "powens",
      providerName: "Powens",
      connections: [
        {
          id: "c1",
          displayName: "My bank",
          status: "ok",
          lastSyncAt: null,
          lastError: null,
          accounts: [{ id: "a1", name: "Checking", typeLabel: "Current", value: "100", lastSyncAt: null }],
        },
      ],
    },
  ],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock("../../api/hooks", () => ({ useConnections: () => connections }));
vi.mock("../../components/AddConnectionModal", () => ({
  AddConnectionModal: () => <div data-testid="add-modal" />,
}));
vi.mock("../../components/DeleteConnectionModal", () => ({
  DeleteConnectionModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="delete-modal">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import { SettingsConnections } from "./Connections";

describe("SettingsConnections", () => {
  it("renders provider group, connection, and account", () => {
    render(<SettingsConnections />);
    expect(screen.getByText("Powens")).toBeInTheDocument();
    expect(screen.getByText("My bank")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
  });

  it("opens add modal on button click", () => {
    render(<SettingsConnections />);
    fireEvent.click(screen.getByRole("button", { name: /add connection/i }));
    expect(screen.getByTestId("add-modal")).toBeInTheDocument();
  });

  it("opens delete modal on delete button click", () => {
    render(<SettingsConnections />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByTestId("delete-modal")).toBeInTheDocument();
  });
});
