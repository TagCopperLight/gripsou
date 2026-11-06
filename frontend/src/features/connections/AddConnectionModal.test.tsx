import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { EnabledProvider } from "../../api/types";
import { goTo } from "../../lib/navigate";
import { AddConnectionModal } from "./AddConnectionModal";
import { renderWithApp, jsonResponse, stubFetch, requestsTo } from "../../test/kit";

vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const providers: EnabledProvider[] = [
  { key: "powens", displayName: "Powens", description: "Banking aggregator" },
];

describe("AddConnectionModal", () => {
  let fetchMock: ReturnType<typeof stubFetch>;
  beforeEach(() => {
    vi.mocked(goTo).mockClear();
    fetchMock = stubFetch(async (url) =>
      url.endsWith("/connections/init")
        ? jsonResponse({ connectionId: "c1", redirectUrl: "https://provider.test/connect" })
        : jsonResponse(providers),
    );
  });

  it("connect button is disabled until a provider is selected", async () => {
    renderWithApp(<AddConnectionModal onClose={() => {}} />);
    await screen.findByText("Powens");
    expect(screen.getByRole("button", { name: /connect/i })).toBeDisabled();
  });

  it("selecting a provider enables the connect button, which starts that provider's connection", async () => {
    renderWithApp(<AddConnectionModal onClose={() => {}} />);
    fireEvent.click(await screen.findByText("Powens"));
    const btn = screen.getByRole("button", { name: /connect/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("https://provider.test/connect"));
    expect(requestsTo(fetchMock, "/connections/init")).toEqual([
      { method: "POST", body: { providerKey: "powens" } },
    ]);
  });
});
