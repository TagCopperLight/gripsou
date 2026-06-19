import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsServer } from "./Server";
import type { Provider } from "../../api/types";

const PROVIDERS: Provider[] = [
  { key: "powens", displayName: "Powens", description: "Bank aggregation.", enabled: true },
];

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("SettingsServer — data providers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/settings/cors")) {
          return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(
          JSON.stringify(init?.method === "PATCH" ? { ...PROVIDERS[0], enabled: false } : PROVIDERS),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
  });

  it("renders a row per provider with name and description", async () => {
    render(withClient(<SettingsServer />));
    expect(await screen.findByText("Powens")).toBeInTheDocument();
    expect(screen.getByText("Bank aggregation.")).toBeInTheDocument();
  });

  it("PATCHes the provider when its toggle is flipped", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    render(withClient(<SettingsServer />));
    await screen.findByText("Powens");
    fireEvent.click(screen.getByRole("switch", { name: "Powens" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/providers/powens",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }),
      ),
    );
  });
});

describe("SettingsServer — CORS origins", () => {
  beforeEach(() => {
    let corsOrigins: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/settings/cors")) {
          if (init?.method === "PATCH") {
            corsOrigins = JSON.parse(init.body as string) as string[];
            return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify(corsOrigins), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
  });

  it("adds a trimmed origin and clears the input, ignoring duplicates", async () => {
    render(withClient(<SettingsServer />));
    const input = await screen.findByPlaceholderText("https://gripsou.example.com");
    const add = screen.getByRole("button", { name: "Add" });

    fireEvent.change(input, { target: { value: "  https://a.test  " } });
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByText("https://a.test")).toBeInTheDocument());
    expect((input as HTMLInputElement).value).toBe("");

    // Duplicate is ignored — still exactly one entry.
    fireEvent.change(input, { target: { value: "https://a.test" } });
    fireEvent.click(add);
    await waitFor(() => expect(screen.getAllByText("https://a.test")).toHaveLength(1));
  });

  it("removes an origin via its delete button", async () => {
    render(withClient(<SettingsServer />));
    const input = await screen.findByPlaceholderText("https://gripsou.example.com");
    fireEvent.change(input, { target: { value: "https://b.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove https://b.test" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remove https://b.test" }));
    await waitFor(() => expect(screen.queryByText("https://b.test")).not.toBeInTheDocument());
  });

  it("disables Add when the input is empty", async () => {
    render(withClient(<SettingsServer />));
    await screen.findByPlaceholderText("https://gripsou.example.com");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });
});
