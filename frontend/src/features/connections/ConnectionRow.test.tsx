import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { SyncConnection } from "../../api/wire";

import { ConnectionRow } from "./ConnectionRow";
import { renderWithApp, jsonResponse, stubFetch, requestsTo } from "../../test/kit";

let fetchMock: ReturnType<typeof stubFetch>;
/** The answer to POST /connections/c1/manage. */
let manage: () => Promise<Response>;
const syncs = () => requestsTo(fetchMock, "/connections/c1/sync");
const manages = () => requestsTo(fetchMock, "/connections/c1/manage");

const conn: SyncConnection = {
  id: "c1",
  displayName: "Caisse d'Épargne",
  canManage: false,
  health: null,
  status: "ok",
  lastSyncAt: null,
  lastError: null,
  logo: null,
  accounts: [
    { id: "a1", name: "LIVRET A", typeKey: "savings", value: "6.87", color: "#4dd0b1", lastSyncAt: null, health: null },
  ],
};

const expand = () => fireEvent.click(screen.getByRole("button", { name: /caisse/i }));

beforeEach(() => {
  vi.restoreAllMocks();
  manage = async () => jsonResponse({ redirectUrl: "https://webview.powens.com/en/manage?code=temporary" });
  fetchMock = stubFetch(async (url) => (url.endsWith("/manage") ? manage() : new Response(null, { status: 204 })));
});

describe("ConnectionRow", () => {


  it("marks an account whose value has no rate today instead of showing 0", () => {
    renderWithApp(<ConnectionRow conn={{ ...conn, accounts: [{ ...conn.accounts[0], value: null }] }} />);
    expand();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/0,00/)).toBeNull();
    expect(screen.getByText(/no exchange rate yet/)).toBeInTheDocument();
  });

  it("keeps the actions hidden until the row is expanded", () => {
    renderWithApp(<ConnectionRow conn={conn} onDelete={() => {}} />);
    // Only the (desktop) icon buttons exist while collapsed.
    expect(screen.queryByText("LIVRET A")).toBeNull();
    expand();
    expect(screen.getByText("LIVRET A")).toBeInTheDocument();
  });

  it("syncs and deletes from the expanded panel", async () => {
    const onDelete = vi.fn();
    renderWithApp(<ConnectionRow conn={conn} onDelete={onDelete} />);
    expand();
    // Icon button + panel button share the label; the panel one is last.
    const syncButtons = screen.getAllByRole("button", { name: /sync now/i });
    fireEvent.click(syncButtons[syncButtons.length - 1]);
    await waitFor(() => expect(syncs()).toEqual([{ method: "POST", body: {} }]));

    const deleteButtons = screen.getAllByRole("button", { name: /delete connection/i });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalled();
  });

  it("doesn't open on a computer when there is nothing to show", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { rerender } = renderWithApp(<ConnectionRow conn={{ ...conn, accounts: [] }} />);
    expand();
    expect(screen.getAllByRole("button", { name: /sync now/i })).toHaveLength(1);
    rerender(<ConnectionRow conn={{ ...conn, status: "pending" }} />);
    expand();
    expect(screen.queryByText("LIVRET A")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("still opens a panel for a connection with no accounts on a phone", () => {
    renderWithApp(<ConnectionRow conn={{ ...conn, accounts: [] }} onDelete={() => {}} />);
    expand();
    expect(
      screen.getAllByRole("button", { name: /sync now/i }).length,
    ).toBeGreaterThan(1);
  });
});

it("keeps the problem's message for the open row, under the accounts", () => {
  const health = { verified: true, lastUpdatedOn: "2026-10-08", state: "bug", errorMessage: "403 Client Error: Forbidden", nextRetryOn: "2026-10-11" };
  renderWithApp(<ConnectionRow conn={{...conn, lastSyncAt:Date.now(), accounts:[{...conn.accounts[0],health},{...conn.accounts[0],id:"a2",name:"Checking",health:{...health,lastUpdatedOn:"2099-10-10",state:null,errorMessage:null,nextRetryOn:null}}]}} />);
  // The problem takes the sync time's place, and the logo carries an amber dot.
  expect(screen.getByText("Partial update")).toBeInTheDocument();
  expect(screen.queryByText(/403 Client Error: Forbidden/)).toBeNull();
  expect(screen.queryByText(/Synced/)).toBeNull();
  expect(screen.getByTestId("connection-warning-dot")).toBeInTheDocument();
  expand();
  // Named after the account it concerns, the retry date under it.
  expect(screen.getByText(/403 Client Error: Forbidden/).parentElement?.textContent).toMatch(/^LIVRET A:\s403/);
  expect(screen.getByText(/Automatic retry on/)).toBeInTheDocument();
  const date = screen.getAllByTitle("Last update from the bank")[0];
  expect(date.parentElement?.textContent).toContain("LIVRET A");
});

it("says a failed sync in words with a red dot, and a healthy one's sync time with no dot", () => {
  const { rerender } = renderWithApp(<ConnectionRow conn={{ ...conn, status: "error", lastError: "sync took too long" }} />);
  expect(screen.getByText("Sync failed")).toHaveAttribute("title", "sync took too long");
  expect(screen.getByTestId("connection-error-dot")).toBeInTheDocument();
  expand();
  expect(screen.getByText("sync took too long")).toBeInTheDocument();
  rerender(<ConnectionRow conn={{ ...conn, lastSyncAt: Date.now() }} />);
  expect(screen.getByText(/Synced/)).toBeInTheDocument();
  expect(screen.queryByTestId(/dot$/)).toBeNull();
});

it("opens Manage with a temporary link and syncs once when returning", async () => {
  const tab = {opener:window,location:{href:"about:blank"},close:vi.fn()};
  vi.spyOn(window,"open").mockReturnValue(tab as unknown as Window);
  renderWithApp(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  await waitFor(()=>expect(tab.location.href).toContain("code=temporary"));
  expect(manages()).toHaveLength(1);
  expect(tab.opener).toBeNull();
  fireEvent.focus(window);
  fireEvent.focus(window);
  await waitFor(() => expect(syncs()).toHaveLength(1));
});

it("handles blocked tabs and failed Manage requests", async () => {
  vi.spyOn(window,"open").mockReturnValue(null);
  const {unmount}=renderWithApp(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  expect(screen.getByRole("alert")).toHaveTextContent("allow pop-ups");
  expect(manages()).toHaveLength(0);
  unmount();
  const close=vi.fn();
  vi.mocked(window.open).mockReturnValue({opener:null,location:{href:""},close} as unknown as Window);
  manage = async () => new Response("provider failed", { status: 502 });
  renderWithApp(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Couldn't open Powens"));
  expect(close).toHaveBeenCalled();
  expect(syncs()).toHaveLength(0);
});

it("closes the tab and says so when the server sends no management link", async () => {
  const close=vi.fn();
  const tab={opener:null,location:{href:"about:blank"},close};
  vi.spyOn(window,"open").mockReturnValue(tab as unknown as Window);
  manage = async () => jsonResponse({ redirectUrl: null });
  renderWithApp(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Couldn't open Powens"));
  expect(close).toHaveBeenCalled();
  expect(tab.location.href).toBe("about:blank");
});

it("discards a delayed Manage response after leaving the page", async () => {
  const close=vi.fn();
  const tab={opener:null,location:{href:"about:blank"},close};
  vi.spyOn(window,"open").mockReturnValue(tab as unknown as Window);
  let resolve!: (value: Response) => void;
  manage = () => new Promise((done)=>{resolve=done;});
  const {unmount}=renderWithApp(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  unmount();
  await waitFor(() => expect(manages()).toHaveLength(1));
  resolve(jsonResponse({redirectUrl:"https://webview.powens.com/en/manage?code=temporary"}));
  await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(tab.location.href).toBe("about:blank");
  fireEvent.focus(window);
  expect(syncs()).toHaveLength(0);
});
