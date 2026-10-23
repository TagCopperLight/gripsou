import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChangePasswordModal } from "./ChangePasswordModal";

function renderModal() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ChangePasswordModal onClose={onClose} onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { onClose, onChanged };
}

function stubFetch(status: number) {
  const fetchMock = vi.fn(async () => new Response(status === 204 ? null : "x", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const set = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fill = (current: string, next: string, confirm = next) => {
  set("Current password", current);
  set("New password", next);
  set("Confirm new password", confirm);
};
const update = () => screen.getByRole("button", { name: "Update password" });
const lengthError = "Your password must be 8 to 128 characters long.";

afterEach(() => vi.unstubAllGlobals());

describe("ChangePasswordModal", () => {
  it("is titled Change password and waits for all three fields", () => {
    stubFetch(204);
    renderModal();
    expect(screen.getByRole("dialog", { name: "Change password" })).toBeInTheDocument();
    expect(update()).toBeDisabled();
    set("Current password", "old-password");
    set("New password", "newpass12");
    expect(update()).toBeDisabled();
    set("Confirm new password", "newpass12");
    expect(update()).toBeEnabled();
  });

  it("posts to /auth/change-password, then reports success and closes", async () => {
    const fetchMock = stubFetch(204);
    const { onClose, onChanged } = renderModal();
    fill("old-password", "newpass12");
    fireEvent.click(update());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ currentPassword: "old-password", newPassword: "newpass12" });
  });

  it("says the current password is wrong on a 400 and stays open", async () => {
    stubFetch(400);
    const { onClose, onChanged } = renderModal();
    fill("old", "newpass12");
    fireEvent.click(update());
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not blame the current password when the server fails", async () => {
    stubFetch(500);
    renderModal();
    fill("old", "newpass12");
    fireEvent.click(update());
    expect(await screen.findByText("Couldn't update password")).toBeInTheDocument();
    expect(screen.queryByText("Current password is incorrect")).not.toBeInTheDocument();
  });

  it("refuses a too-short password on click without calling the server", () => {
    const fetchMock = stubFetch(204);
    renderModal();
    expect(screen.queryByText("At least 8 characters")).not.toBeInTheDocument();
    fill("old-password", "1234567");
    expect(update()).toBeEnabled();
    expect(screen.queryByText(lengthError)).not.toBeInTheDocument();
    fireEvent.click(update());
    expect(screen.getByText(lengthError)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    // Editing the new password clears the error.
    set("New password", "12345678");
    expect(screen.queryByText(lengthError)).not.toBeInTheDocument();
  });

  it("sends a password of 8 characters", async () => {
    const fetchMock = stubFetch(204);
    const { onClose } = renderModal();
    fill("old-password", "12345678");
    fireEvent.click(update());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("says when the two new passwords differ and keeps Update disabled", () => {
    stubFetch(204);
    renderModal();
    fill("old-password", "newpass12", "newpass13");
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    expect(update()).toBeDisabled();
    set("Confirm new password", "newpass12");
    expect(screen.queryByText("Passwords don't match")).not.toBeInTheDocument();
  });

  it("closes on Cancel without calling the server", () => {
    const fetchMock = stubFetch(204);
    const { onClose, onChanged } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
