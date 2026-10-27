import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AccountsList } from "./AccountsList";

describe("AccountsList", () => {
  it("shows nothing while the user has no accounts", async () => {
    const fetch = vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}><AccountsList /></QueryClientProvider>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("All accounts")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
