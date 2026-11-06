import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Reset } from "./Reset";
import { DEFAULT_PREFS } from "../../api/wire";
import { signedOut, renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  getRouteApi: () => ({ useParams: () => ({ token: "tok" }) }),
}));

beforeEach(() => navigate.mockClear());

describe("Reset", () => {
  it("sets a new password and adopts the session", async () => {
    const adopt = vi.fn();
    stubFetch()
      .mockResolvedValueOnce(
        jsonResponse({ type: "reset", email: "u@t.local" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
            token: "sess",
            user: { id: "u1", name: "U", email: "u@t.local", role: "user", prefs: DEFAULT_PREFS },
          }),
      );
    renderWithApp(<Reset />, { auth: signedOut({ adoptSession: adopt }) });

    await screen.findByLabelText("New password");
    expect(screen.getByText("u@t.local")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(adopt).toHaveBeenCalledWith("sess", expect.objectContaining({ id: "u1" })));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("refuses a too-short password without calling the server", async () => {
    const fetchMock = stubFetch()
      .mockResolvedValueOnce(
        jsonResponse({ type: "reset", email: "u@t.local" }),
      );
    renderWithApp(<Reset />, { auth: signedOut() });

    await screen.findByLabelText("New password");
    expect(screen.queryByText("At least 8 characters")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "1234567" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Your password must be 8 to 128 characters long.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/redeem"))).toBe(false);
  });

  it.each([
    [404, true],
    [500, false],
  ])("blames the link only when the server says it's gone (%i)", async (status, blamed) => {
    stubFetch()
      .mockResolvedValueOnce(Response.json({ type: "reset", email: "u@t.local" }))
      .mockResolvedValueOnce(new Response("no", { status }));
    renderWithApp(<Reset />, { auth: signedOut() });

    await screen.findByLabelText("New password");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Update password" })).toBeEnabled());
    expect(screen.queryByText("This reset link is no longer valid.") !== null).toBe(blamed);
  });
});
