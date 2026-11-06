import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTokenGuard } from "./useTokenGuard";
import { jsonResponse, stubFetch } from "../test/kit";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockClear();
});

describe("useTokenGuard", () => {
  it("returns the token info when valid", async () => {
    stubFetch(async () => jsonResponse({ type: "invite", email: null }));
    const { result } = renderHook(() => useTokenGuard("tok"));
    await waitFor(() => expect(result.current.status).toBe("valid"));
    expect(result.current.info).toEqual({ type: "invite", email: null });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects to / on an invalid token", async () => {
    stubFetch(async () => new Response("no", { status: 404 }));
    renderHook(() => useTokenGuard("bad"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });
});
