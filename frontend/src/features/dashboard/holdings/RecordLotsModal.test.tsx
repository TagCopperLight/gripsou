import { act, type ReactElement } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { RecordLotsModal } from "./RecordLotsModal";
import type { BasisPreview, Holding, Lot, LotEntry, LotSuggestion } from "../../../api/wire";
import { renderWithApp, jsonResponse, stubFetch, requestsTo } from "../../../test/kit";

let txns: Lot[] = [];
let suggestions: LotSuggestion[] = [];
let suggestionsFailed = false;
let saveFails = false;

// Fixed sentinel answers from the preview endpoint, deliberately not the basis
// formula: they prove the row set reaches the server and the figures it sends
// back reach the screen, and nothing about the formula, which only the
// backend computes.
const PREVIEW_RESULTS: BasisPreview[] = [
  { meanPrice: "25", invested: "375", realised: "0", unrealised: "12", reporting: null },
  { meanPrice: "30", invested: "400", realised: "5", unrealised: "20", reporting: null },
  { meanPrice: "35", invested: "450", realised: "7", unrealised: "25", reporting: null },
];
const ZERO: BasisPreview = { meanPrice: "0", invested: "0", realised: "0", unrealised: "0", reporting: null };

let previewCallCount: number;
// When true, a preview answer is queued instead of sent at once, so a test can
// look at the screen while a request is in flight.
let holdPreviewResolution: boolean;
let heldResolvers: Array<() => void>;
let fetchMock: ReturnType<typeof stubFetch>;

function stubServer() {
  fetchMock = stubFetch(async (url, init) => {
    if (url.endsWith("/lots/preview")) {
      const { rows } = JSON.parse(String(init?.body)) as { rows: LotEntry[] };
      // An empty holding previews zero without using up a sentinel.
      const result = rows.length === 0 ? ZERO : PREVIEW_RESULTS[Math.min(previewCallCount, PREVIEW_RESULTS.length - 1)];
      if (rows.length > 0) previewCallCount += 1;
      if (!holdPreviewResolution) return jsonResponse(result);
      return new Promise<Response>((done) => heldResolvers.push(() => done(jsonResponse(result))));
    }
    if (url.endsWith("/lots/suggestions")) {
      return suggestionsFailed ? new Response("x", { status: 500 }) : jsonResponse(suggestions);
    }
    if (url.endsWith("/lots") && init?.method === "PUT") {
      return new Response(saveFails ? "x" : null, { status: saveFails ? 500 : 204 });
    }
    return jsonResponse(txns);
  });
}

/** The rows each preview request sent, oldest first. */
const previews = () => requestsTo(fetchMock, "/lots/preview").map((r) => (r.body as { rows: LotEntry[] }).rows);
/** The bodies of the save requests. */
const saves = () => requestsTo(fetchMock, "/holdings/h1/lots").filter((r) => r.method === "PUT").map((r) => r.body);

/** Let in-flight answers land: a fetch answer reaches the screen a few ticks later. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 20)));

async function releaseHeldPreview() {
  const resolve = heldResolvers.shift();
  if (resolve) resolve();
  await settle();
}

/** Render the modal once its lots and suggestions have loaded. */
async function renderModal(ui: ReactElement) {
  const view = renderWithApp(ui);
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  await settle();
  return view;
}

/** The "x / y shares accounted for" line above the bar. */
const accountedLine = () =>
  screen.getByText((_, el) => el?.tagName === "SPAN" && /shares accounted for$/.test(el.textContent ?? "")).textContent;

/** A background refetch that hands the modal the current `txns`. */
async function refetch(client: QueryClient) {
  await act(() => client.refetchQueries());
  await settle();
}

const holding = {
  id: "h1",
  ticker: "PAEEM",
  name: "BNP Easy S&P 500",
  logo: null,
  accountName: "PEA",
  accountColor: "#34d399",
  accountType: "pea",
  qty: "20",
  price: "40",
  accountCurrency: "EUR",
  unexplainedQty: "20",
} as Holding;

const lot = (id: string, side: "buy" | "sell", qty: string, price: string, fee = "0"): Lot => ({
  id,
  t: Date.parse("2024-05-02T00:00:00Z"),
  side,
  qty,
  price,
  fee,
  manual: true,
});

describe("RecordLotsModal", () => {
  beforeEach(() => {
    txns = [];
    suggestions = [];
    suggestionsFailed = false;
    saveFails = false;
    previewCallCount = 0;
    holdPreviewResolution = false;
    heldResolvers = [];
    stubServer();
  });
  // This runs while the modal is still mounted (Vitest unwinds afterEach hooks
  // in reverse registration order, so RTL's auto-cleanup — registered when this
  // file imported it — goes last). `changeLanguage` emits `languageChanged`,
  // which re-renders every mounted `useTranslation` consumer, so it must be
  // acted on or React reports an un-acted update for each one.
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("lists a provider's lot locked, counts it, and never sends it", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20"), { ...lot("b", "buy", "5", "20"), manual: false }];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getAllByTestId("lot-row")).toHaveLength(2);
    expect(screen.getByLabelText(/sent by your bank/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /delete entry/i })).toHaveLength(1);
    expect(accountedLine()).toBe("15 / 20 shares accounted for");
    // The server keeps the provider's lots itself: only the user's rows go out.
    expect(previews().at(-1)).toEqual([{ type: "buy", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" }]);

    await user.click(screen.getByRole("button", { name: /delete entry/i }));
    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    expect(saves()).toContainEqual({ adds: [], deletes: ["a"] });
  });

  it("saves a row switched from purchase to sale as a changed row", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "Sale" }));
    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    expect(saves()).toContainEqual({
      adds: [{ type: "sell", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" }],
      deletes: ["a"],
    });
  });

  it("puts a row back in date order once its date is set, not while typing", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    const date = screen.getAllByTestId("lot-date")[1];
    fireEvent.change(date, { target: { value: "2023-01-15" } });
    expect(screen.getAllByTestId("lot-date").map((d) => (d as HTMLInputElement).value)).toEqual(["2024-05-02", "2023-01-15"]);
    fireEvent.blur(date);
    expect(screen.getAllByTestId("lot-date").map((d) => (d as HTMLInputElement).value)).toEqual(["2023-01-15", "2024-05-02"]);
  });

  it("shows no figure while nothing is recorded, not the server's zeros", async () => {
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("—");
    expect(screen.getByTestId("figure-realised")).toHaveTextContent("—");
  });

  it("shows no figure until the first preview answers", async () => {
    holdPreviewResolution = true;
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("—");
    await releaseHeldPreview();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
  });

  it("shows the populated preview immediately when lots have loaded", async () => {
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
    expect(previews()).toHaveLength(1);
    expect(previews()).toContainEqual([
      { type: "buy", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" },
    ]);
  });

  it("ignores an older preview that finishes after a newer edit", async () => {
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("figure-invested")).toHaveTextContent("375"));
    holdPreviewResolution = true;
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "11" } });
    await waitFor(() => expect(heldResolvers).toHaveLength(1));
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "12" } });
    await waitFor(() => expect(heldResolvers).toHaveLength(2));
    heldResolvers[1]();
    await settle();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("450");
    heldResolvers[0]();
    await settle();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("450");
  });

  it("keeps prior figures when an outdated preview finishes during the next debounce", async () => {
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("figure-invested")).toHaveTextContent("375"));
    holdPreviewResolution = true;
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "11" } });
    await waitFor(() => expect(heldResolvers).toHaveLength(1));
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "12" } });
    await releaseHeldPreview();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
    await waitFor(() => expect(heldResolvers).toHaveLength(1));
    await releaseHeldPreview();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("450");
  });

  it("debounces rapid edits after the initial populated preview", async () => {
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "11" } });
      await act(() => vi.advanceTimersByTimeAsync(100));
      fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "12" } });
      await act(() => vi.advanceTimersByTimeAsync(299));
      expect(previews()).toHaveLength(1);
      expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(previews()).toHaveLength(2);
      expect(previews().at(-1)).toEqual([
        { type: "buy", date: "2024-05-02", quantity: "12", unitPrice: "20", fee: "0" },
      ]);
      expect(screen.getByTestId("figure-invested")).toHaveTextContent("400");
    } finally { vi.useRealTimers(); }
  });

  // The figures are the server's, verbatim: the right rows reach the preview
  // endpoint and whatever it answers reaches the screen. The formula itself is
  // the backend's alone.
  it("shows the resulting figures the preview endpoint returns", async () => {
    txns = [lot("a", "buy", "10", "20"), lot("b", "buy", "10", "30"), lot("c", "sell", "5", "35")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    // Check the row payload as well as the returned figures: sentinel figures
    // alone cannot distinguish a correctly seeded request from a wrong one.
    await waitFor(() =>
      expect(previews()).toContainEqual([
        { type: "buy", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" },
        { type: "buy", date: "2024-05-02", quantity: "10", unitPrice: "30", fee: "0" },
        { type: "sell", date: "2024-05-02", quantity: "5", unitPrice: "35", fee: "0" },
      ]),
    );
    expect(screen.getByTestId("figure-meanPrice")).toHaveTextContent("25");
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
    expect(screen.getByTestId("figure-realised")).toHaveTextContent("0");
    expect(screen.getByTestId("figure-unrealised")).toHaveTextContent("12");
  });

  // TanStack Query resets a mutation's `data` to `undefined` the moment it goes
  // pending again: the modal holds the last figures itself until a new answer
  // lands, instead of blanking them to 0,00 € on every edit.
  it("keeps the previous figures on screen while a new preview is in flight", async () => {
    txns = [lot("a", "buy", "10", "20")];
    const user = userEvent.setup();
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("figure-meanPrice")).toHaveTextContent("25"));

    holdPreviewResolution = true;
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[1], "1");
    await user.type(screen.getAllByTestId("lot-unitPrice")[1], "10");

    // The edit's debounced preview call has fired and is being held pending —
    // the panel must still show the FIRST result, not zero.
    await waitFor(() => expect(previewCallCount).toBe(2));
    expect(screen.getByTestId("figure-meanPrice")).toHaveTextContent("25");
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");

    holdPreviewResolution = false;
    await releaseHeldPreview();
    await waitFor(() => expect(screen.getByTestId("figure-meanPrice")).toHaveTextContent("30"));
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("400");
  });

  it("disables Save when there is nothing to save", async () => {
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("disables Save while a row is malformed, and the bar ignores that row", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[1], "0");
    await user.type(screen.getAllByTestId("lot-unitPrice")[1], "10");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    // The invalid row contributed nothing.
    expect(accountedLine()).toBe("10 / 20 shares accounted for");
    // Nor the preview request: the invalid row must never reach the server, only
    // the one valid buy of 10@20.
    await waitFor(() =>
      expect(previews()).toContainEqual([
        { type: "buy", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" },
      ]),
    );
  });

  // The server rejects an empty date at deserialization (400, nothing saved),
  // so a row with no date must stay out of the bar and keep Save disabled —
  // Save must never offer a batch the server would refuse.
  it("keeps Save disabled and the bar unmoved when a row's date is empty", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    const dateInput = screen.getAllByTestId("lot-date")[1];
    await user.clear(dateInput);
    await user.type(screen.getAllByTestId("lot-quantity")[1], "5");
    await user.type(screen.getAllByTestId("lot-unitPrice")[1], "10");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    // The dateless row contributed nothing.
    expect(accountedLine()).toBe("10 / 20 shares accounted for");
  });

  // Over-recording is information, not an error: a user may enter a sale before
  // the buy it came from.
  it("keeps Save enabled when more is recorded than held", async () => {
    const user = userEvent.setup();
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[0], "50");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "10");
    expect(accountedLine()).toBe("50 / 20 shares accounted for");
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("sends adds and deletes in one batch", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /delete entry/i }));
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.click(screen.getAllByRole("radio", { name: "Sale" }).at(-1)!);
    const rows = screen.getAllByTestId("lot-row");
    const dateInput = screen.getAllByTestId("lot-date")[rows.length - 1];
    await user.clear(dateInput);
    await user.type(dateInput, "2024-06-02");
    await user.type(screen.getAllByTestId("lot-quantity")[rows.length - 1], "5");
    await user.type(screen.getAllByTestId("lot-unitPrice")[rows.length - 1], "18");

    await user.click(screen.getByRole("button", { name: /save 2 entries/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()).toContainEqual({
      adds: [{ type: "sell", date: "2024-06-02", quantity: "5", unitPrice: "18" }],
      deletes: ["a"],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("sends the fee with a saved lot", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    txns = [];
    await renderModal(<RecordLotsModal holding={holding} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[0], "2");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "98.37");
    await user.type(screen.getAllByTestId("lot-fee")[0], "1.05");

    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    const saved = saves()[0] as { adds: unknown[] };
    expect(saved.adds[0]).toMatchObject({ quantity: "2", unitPrice: "98.37", fee: "1.05" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("reads a French decimal comma", async () => {
    await i18n.changeLanguage("fr");
    const user = userEvent.setup();
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /ajouter une opération/i }));
    const frDateInput = screen.getAllByTestId("lot-date")[0];
    await user.clear(frDateInput);
    await user.type(frDateInput, "2024-06-02");
    await user.type(screen.getAllByTestId("lot-quantity")[0], "20");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "15,617");
    await user.click(screen.getByRole("button", { name: /enregistrer/i }));
    await waitFor(() =>
      expect(saves()).toContainEqual({
        adds: [{ type: "buy", date: "2024-06-02", quantity: "20", unitPrice: "15.617" }],
        deletes: [],
      }),
    );
  });

  it("sends a changed saved row as a delete + re-add in one batch, and counts it as one entry", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={onClose} />);

    const qtyInput = screen.getAllByTestId("lot-quantity")[0];
    await user.clear(qtyInput);
    await user.type(qtyInput, "12");

    expect(screen.getByRole("button", { name: /save 1 entry/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()).toContainEqual({
      adds: [{ type: "buy", date: "2024-05-02", quantity: "12", unitPrice: "20", fee: "0" }],
      deletes: ["a"],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("leaves Save disabled and sends nothing when a saved row is edited then reverted", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);

    const qtyInput = screen.getAllByTestId("lot-quantity")[0];
    await user.clear(qtyInput);
    await user.type(qtyInput, "12");
    expect(screen.getByRole("button", { name: /save 1 entry/i })).toBeEnabled();

    await user.clear(qtyInput);
    await user.type(qtyInput, "10");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(saves()).toHaveLength(0);
  });

  // The server picks its own decimal scale, so a PEA lot comes back as "16.030"
  // while the user retypes the same price as "16.03". Treating that as an edit
  // would burn the row's id on a delete + re-add that changes nothing, and count
  // a phantom entry on the Save button.
  it("does not treat a retyped equivalent decimal as a change", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10.00", "16.030")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    const price = screen.getAllByTestId("lot-unitPrice")[0];
    await user.clear(price);
    await user.type(price, "16.03");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(saves()).toHaveLength(0);
  });

  it("does not treat a retyped equivalent French decimal as a change", async () => {
    await i18n.changeLanguage("fr");
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10.00", "16.030")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    const price = screen.getAllByTestId("lot-unitPrice")[0];
    await user.clear(price);
    await user.type(price, "16,03");
    expect(screen.getByRole("button", { name: /enregistrer/i })).toBeDisabled();
    expect(saves()).toHaveLength(0);
  });

  it("keeps Save disabled when an edit to a saved row makes it invalid", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);

    const qtyInput = screen.getAllByTestId("lot-quantity")[0];
    await user.clear(qtyInput);
    await user.type(qtyInput, "0");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  // The whole justification for the dirty-flag seeding design: a refetch
  // that lands mid-edit must not clobber what the user is typing.
  it("preserves an in-progress edit across a refetch that returns a new data reference", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    const { client } = await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);

    const qtyInput = screen.getAllByTestId("lot-quantity")[0];
    await user.clear(qtyInput);
    await user.type(qtyInput, "17");

    // A new array reference with the same underlying row — simulates a
    // background refetch completing while the user is mid-edit.
    txns = [lot("a", "buy", "10", "20")];
    await refetch(client);

    expect(screen.getAllByTestId("lot-quantity")[0]).toHaveValue("17");
  });

  it("keeps the modal open and reports the error when the save fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    saveFails = true;
    await renderModal(<RecordLotsModal holding={holding} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    const failDateInput = screen.getAllByTestId("lot-date")[0];
    await user.clear(failDateInput);
    await user.type(failDateInput, "2024-06-02");
    await user.type(screen.getAllByTestId("lot-quantity")[0], "5");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "10");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText("Couldn't save the buy/sell history")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("suggestions", () => {
    const suggestion: LotSuggestion = {
      type: "buy",
      date: "2026-10-08",
      quantity: "23",
      unitPrice: "6.35521739",
      fee: "0",
    };

    it("keeps suggestions out of the table and off the Save button until added", async () => {
      txns = [lot("a", "buy", "10", "20")];
      suggestions = [suggestion];
      await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      expect(screen.getByRole("region", { name: "1 purchase found in your transactions" })).toBeInTheDocument();
      expect(screen.getAllByTestId("lot-row")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("adds a suggestion as an editable row in date order, and saves it unchanged", async () => {
      txns = [lot("a", "buy", "10", "20")];
      suggestions = [{ ...suggestion, date: "2024-01-03" }];
      const user = userEvent.setup();
      await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.queryByRole("region", { name: /found in your transactions/ })).not.toBeInTheDocument();
      expect(screen.getAllByTestId("lot-date").map((d) => (d as HTMLInputElement).value)).toEqual(["2024-01-03", "2024-05-02"]);
      await user.click(screen.getByRole("button", { name: "Save 1 entry" }));
      expect(saves()).toContainEqual({
        adds: [{ type: "buy", date: "2024-01-03", quantity: "23", unitPrice: "6.35521739", fee: "0" }],
        deletes: [],
      });
    });

    it("adds them all at once, and puts a binned one back in the panel", async () => {
      suggestions = [suggestion, { ...suggestion, date: "2026-10-09" }];
      const user = userEvent.setup();
      await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Add all" }));
      expect(screen.getAllByTestId("lot-row")).toHaveLength(2);
      await user.click(screen.getAllByRole("button", { name: /delete entry/i })[0]);
      expect(screen.getByRole("region", { name: "1 purchase found in your transactions" })).toBeInTheDocument();
      expect(screen.getAllByTestId("lot-row")).toHaveLength(1);
    });

    it("hides the panel on Dismiss without adding anything", async () => {
      suggestions = [suggestion];
      const user = userEvent.setup();
      await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("region", { name: /found in your transactions/ })).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("lot-row")).toHaveLength(0);
    });

    it("still shows the saved lots when suggestions fail to load", async () => {
      txns = [lot("a", "buy", "10", "20")];
      suggestionsFailed = true;
      await renderModal(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      expect(screen.getAllByTestId("lot-row")).toHaveLength(1);
    });
  });
});
