import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { ConnectionCallback } from "./ConnectionCallback";
import { renderWithApp, stubFetch, requestsTo } from "../../test/kit";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

/** Land on the callback page with the query string Powens redirected to. */
function landWith(search: string) {
  window.history.pushState({}, "", `/connections/callback${search}`);
}

const noContent = () => new Response(null, { status: 204 });

const ERROR_TITLE = "Your bank couldn't be connected";
const CONNECTING = "Connecting your bank…";

let fetchMock: ReturnType<typeof stubFetch>;

beforeEach(() => {
  navigate.mockClear();
  fetchMock = stubFetch(async () => noContent());
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("ConnectionCallback", () => {
  it("completes the connection, then goes to the connections page", async () => {
    landWith("?state=c42&code=abc&connection_id=7");
    renderWithApp(<ConnectionCallback />);

    expect(screen.getByText(CONNECTING)).toBeInTheDocument();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" }),
    );
    expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
  });

  it("shows the failure at once when the provider reports an error", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/connections/complete" ? new Response("boom", { status: 400 }) : noContent(),
    );
    landWith("?state=c42&error=access_denied");
    renderWithApp(<ConnectionCallback />);

    expect(screen.getByText(ERROR_TITLE)).toBeInTheDocument();
    await waitFor(() => expect(requestsTo(fetchMock, "/connections/complete")).toHaveLength(1));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the failure when completing fails, with the way back", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/connections/complete" ? new Response("boom", { status: 500 }) : noContent(),
    );
    landWith("?state=c42&code=abc");
    renderWithApp(<ConnectionCallback />);

    expect(await screen.findByText(ERROR_TITLE)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to connections" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" });
  });
});
