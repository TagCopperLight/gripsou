import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SyncConnection } from "../api/types";

const remove = { mutate: vi.fn(), isPending: false, isError: false };
vi.mock("../api/hooks", () => ({ useDeleteConnection: () => remove }));

import { DeleteConnectionModal } from "./DeleteConnectionModal";

const conn: SyncConnection = {
  id: "c1",
  displayName: "My bank",
  status: "ok",
  lastSyncAt: null,
  lastError: null,
  accounts: [],
  logo: null,
};

describe("DeleteConnectionModal", () => {
  it("renders title and body text", () => {
    render(
      <DeleteConnectionModal
        connection={conn}
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /delete connection/i })).toBeInTheDocument();
  });

  it("calls mutate with the connection id on confirm", () => {
    render(
      <DeleteConnectionModal
        connection={conn}
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete connection/i }));
    expect(remove.mutate).toHaveBeenCalledWith("c1", expect.any(Object));
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <DeleteConnectionModal
        connection={conn}
        onClose={onClose}
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
