import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Login } from "./Login";
import { AuthProvider } from "../auth/AuthProvider";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

function wrap(children: ReactNode) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("Login", () => {
  beforeEach(() => navigate.mockReset());

  it("logs in and navigates to the dashboard on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ token: "t", user: { id: "u1", name: "Ann", email: "a@t.local", role: "admin" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(wrap(<Login />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("shows an error on bad credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    render(wrap(<Login />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
