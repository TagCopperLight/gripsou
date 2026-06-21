import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTokenGuard } from "./useTokenGuard";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockClear();
});

describe("useTokenGuard", () => {
  it("returns the token info when valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ type: "invite", email: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const { result } = renderHook(() => useTokenGuard("tok"));
    await waitFor(() => expect(result.current.status).toBe("valid"));
    expect(result.current.info).toEqual({ type: "invite", email: null });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects to / on an invalid token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
    renderHook(() => useTokenGuard("bad"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });
});
