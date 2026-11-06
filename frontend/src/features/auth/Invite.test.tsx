import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Invite } from "./Invite";
import { DEFAULT_PREFS } from "../../api/wire";
import { signedOut, renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  getRouteApi: () => ({ useParams: () => ({ token: "tok" }) }),
}));

const tokenOk = () =>
  jsonResponse({ type: "invite", email: null });

beforeEach(() => {
  navigate.mockClear();
});

describe("Invite", () => {
  it("creates an account and adopts the session", async () => {
    const adopt = vi.fn();
    stubFetch()
      .mockResolvedValueOnce(tokenOk()) // page-load guard
      .mockResolvedValueOnce(
        jsonResponse({
            token: "sess",
            user: { id: "u1", name: "New", email: "new@t.local", role: "user", prefs: DEFAULT_PREFS },
          }),
      );
    renderWithApp(<Invite />, { auth: signedOut({ adoptSession: adopt }) });

    await screen.findByLabelText("Name");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@t.local" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(adopt).toHaveBeenCalledWith("sess", expect.objectContaining({ id: "u1" })));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("refuses a too-short password without calling the server", async () => {
    const fetchMock = stubFetch().mockResolvedValueOnce(tokenOk());
    renderWithApp(<Invite />, { auth: signedOut() });

    await screen.findByLabelText("Name");
    expect(screen.queryByText("At least 8 characters")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Short" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "1234567" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Your password must be 8 to 128 characters long.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/redeem"))).toBe(false);
  });

  it("asks for a name left blank, without calling the server", async () => {
    const fetchMock = stubFetch().mockResolvedValueOnce(tokenOk());
    renderWithApp(<Invite />, { auth: signedOut() });

    await screen.findByLabelText("Name");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/redeem"))).toBe(false);
  });

  it("shows an email-exists error on 409", async () => {
    stubFetch()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(new Response("dup", { status: 409 }));
    renderWithApp(<Invite />, { auth: signedOut() });

    await screen.findByLabelText("Name");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("An account already uses this email.")).toBeInTheDocument();
  });
});
