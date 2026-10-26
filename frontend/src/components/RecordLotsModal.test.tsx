import { act, useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { RecordLotsModal } from "./RecordLotsModal";
import type { BasisPreview, Holding, Lot, LotSuggestion } from "../api/types";
import type { SaveLotAdd } from "../api/hooks";

const mutateAsync = vi.fn();
let txns: Lot[] = [];
let suggestions: LotSuggestion[] = [];
let suggestionsFailed = false;

// Fixed sentinel responses for the mocked preview endpoint. Deliberately NOT a
// reimplementation of the basis formula (that was the bug in fix round 1:
// wrong, fee-blind, and it let a test assert only that the UI echoes what the
// test itself computed). These prove the plumbing — the row set reaching the
// server and the figures the server sends back reaching the screen — and
// nothing about the formula, which only the backend may compute.
const PREVIEW_RESULTS: BasisPreview[] = [
  { meanPrice: "25", invested: "375", realised: "0", unrealised: "12", reporting: null },
  { meanPrice: "30", invested: "400", realised: "5", unrealised: "20", reporting: null },
  { meanPrice: "35", invested: "450", realised: "7", unrealised: "25", reporting: null },
];

let previewMutate: ReturnType<typeof vi.fn<(rows: SaveLotAdd[]) => void>>;
let previewCallCount: number;
// When true, a preview resolution is queued instead of applied immediately —
// lets a test inspect state while a request is deliberately left "in flight".
let holdPreviewResolution: boolean;
let heldResolvers: Array<() => void>;

function releaseHeldPreview() {
  const resolve = heldResolvers.shift();
  if (resolve) act(resolve);
}

vi.mock("../api/hooks", async () => {
  const actual = await vi.importActual<typeof import("../api/hooks")>("../api/hooks");
  return {
    ...actual,
    useSaveLots: () => ({ mutateAsync, isPending: false }),
    useHoldingLots: () => ({ data: txns, isError: false, refetch: vi.fn() }),
    useLotSuggestions: () =>
      suggestionsFailed
        ? { data: undefined, isPending: false, isError: true }
        : { data: suggestions, isPending: false, isError: false },
    // Mirrors the one behaviour that mattered for fix round 1's flicker bug:
    // TanStack Query's real `useMutation` resets `data` to `undefined` the
    // instant a mutation goes pending, and only `onSuccess` carries the next
    // value. A mock that kept the previous `data` around (as fix round 1's
    // did) could not have caught the regression.
    useLotsPreview: () => {
      const [data, setData] = useState<BasisPreview | undefined>(undefined);
      return {
        mutate: (rows: SaveLotAdd[], options?: { onSuccess?: (d: BasisPreview) => void }) => {
          previewMutate(rows);
          setData(undefined);
          // An empty holding previews zero without consuming a sentinel used
          // by assertions about populated rows.
          const result =
            rows.length === 0
              ? { meanPrice: "0", invested: "0", realised: "0", unrealised: "0", reporting: null }
              : PREVIEW_RESULTS[Math.min(previewCallCount, PREVIEW_RESULTS.length - 1)];
          if (rows.length > 0) previewCallCount += 1;
          const resolve = () => {
            setData(result);
            options?.onSuccess?.(result);
          };
          if (holdPreviewResolution) {
            heldResolvers.push(resolve);
          } else {
            resolve();
          }
        },
        data,
        isPending: false,
      };
    },
  };
});

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
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(undefined);
    txns = [];
    suggestions = [];
    suggestionsFailed = false;
    previewMutate = vi.fn<(rows: SaveLotAdd[]) => void>();
    previewCallCount = 0;
    holdPreviewResolution = false;
    heldResolvers = [];
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
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getAllByTestId("lot-row")).toHaveLength(2);
    expect(screen.getByLabelText(/sent by your bank/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /delete entry/i })).toHaveLength(1);
    expect(screen.getByText((_, el) => /^15 \/ \d+ shares accounted for$/.test(el?.textContent ?? "") && el?.tagName === "SPAN")).toBeInTheDocument();
    // The server keeps the provider's lots itself: only the user's rows go out.
    expect(previewMutate).toHaveBeenLastCalledWith([{ type: "buy", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" }]);

    await user.click(screen.getByRole("button", { name: /delete entry/i }));
    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    expect(mutateAsync).toHaveBeenCalledWith({ adds: [], deletes: ["a"] });
  });

  it("saves a row switched from purchase to sale as a changed row", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "Sale" }));
    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    expect(mutateAsync).toHaveBeenCalledWith({
      adds: [{ type: "sell", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" }],
      deletes: ["a"],
    });
  });

  it("puts a row back in date order once its date is set, not while typing", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    const date = screen.getAllByTestId("lot-date")[1];
    fireEvent.change(date, { target: { value: "2023-01-15" } });
    expect(screen.getAllByTestId("lot-date").map((d) => (d as HTMLInputElement).value)).toEqual(["2024-05-02", "2023-01-15"]);
    fireEvent.blur(date);
    expect(screen.getAllByTestId("lot-date").map((d) => (d as HTMLInputElement).value)).toEqual(["2023-01-15", "2024-05-02"]);
  });

  it("shows no figure while nothing is recorded, not the server's zeros", () => {
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("—");
    expect(screen.getByTestId("figure-realised")).toHaveTextContent("—");
  });

  it("shows no figure until the first preview answers", () => {
    holdPreviewResolution = true;
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("—");
    releaseHeldPreview();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
  });

  it("shows the populated preview immediately when lots have loaded", () => {
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(previewMutate).toHaveBeenCalledWith([
      { type: "buy", date: "2024-05-02", quantity: "10", unitPrice: "20", fee: "0" },
    ]);
  });

  it("ignores an older preview that finishes after a newer edit", async () => {
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("figure-invested")).toHaveTextContent("375"));
    holdPreviewResolution = true;
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "11" } });
    await waitFor(() => expect(heldResolvers).toHaveLength(1));
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "12" } });
    await waitFor(() => expect(heldResolvers).toHaveLength(2));
    act(heldResolvers[1]);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("450");
    act(heldResolvers[0]);
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("450");
  });

  it("keeps prior figures when an outdated preview finishes during the next debounce", async () => {
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("figure-invested")).toHaveTextContent("375"));
    holdPreviewResolution = true;
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "11" } });
    await waitFor(() => expect(heldResolvers).toHaveLength(1));
    fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "12" } });
    releaseHeldPreview();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
    await waitFor(() => expect(heldResolvers).toHaveLength(1));
    releaseHeldPreview();
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("450");
  });

  it("debounces rapid edits after the initial populated preview", async () => {
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "11" } });
      await act(() => vi.advanceTimersByTimeAsync(100));
      fireEvent.change(screen.getByTestId("lot-quantity"), { target: { value: "12" } });
      await act(() => vi.advanceTimersByTimeAsync(299));
      expect(previewMutate).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(previewMutate).toHaveBeenCalledTimes(2);
      expect(previewMutate).toHaveBeenLastCalledWith([
        { type: "buy", date: "2024-05-02", quantity: "12", unitPrice: "20", fee: "0" },
      ]);
      expect(screen.getByTestId("figure-invested")).toHaveTextContent("400");
    } finally { vi.useRealTimers(); }
  });

  it("colours the bar amber when short, green on a match, red when over", () => {
    txns = [lot("a", "buy", "10", "20")];
    const { rerender } = render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByTestId("accounted-bar")).toHaveClass("bg-amber");

    txns = [lot("a", "buy", "20", "20")];
    rerender(<RecordLotsModal holding={{ ...holding }} onClose={vi.fn()} />);
    expect(screen.getByTestId("accounted-bar")).toHaveClass("bg-green");

    txns = [lot("a", "buy", "25", "20")];
    rerender(<RecordLotsModal holding={{ ...holding }} onClose={vi.fn()} />);
    expect(screen.getByTestId("accounted-bar")).toHaveClass("bg-red");
  });

  // The figures are the server's, verbatim — this proves the plumbing (the
  // right rows reach `mutate`, and whatever it resolves with reaches the
  // screen), not the formula. The formula itself is the backend's alone.
  it("shows the resulting figures the preview endpoint returns", async () => {
    txns = [lot("a", "buy", "10", "20"), lot("b", "buy", "10", "30"), lot("c", "sell", "5", "35")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    // Check the row payload as well as the returned figures: sentinel figures
    // alone cannot distinguish a correctly seeded request from a wrong one.
    await waitFor(() =>
      expect(previewMutate).toHaveBeenCalledWith([
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

  // Fix round 1: `preview.data ?? ZERO` blanked every figure to 0,00 € on
  // every edit after the first, because TanStack Query resets a mutation's
  // `data` to `undefined` the moment it goes pending again. The modal must
  // hold the last successful figures itself and keep showing them until a
  // new result actually lands.
  it("keeps the previous figures on screen while a new preview is in flight", async () => {
    txns = [lot("a", "buy", "10", "20")];
    const user = userEvent.setup();
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
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
    releaseHeldPreview();
    await waitFor(() => expect(screen.getByTestId("figure-meanPrice")).toHaveTextContent("30"));
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("400");
  });

  it("disables Save when there is nothing to save", () => {
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("disables Save while a row is malformed, and the bar ignores that row", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[1], "0");
    await user.type(screen.getAllByTestId("lot-unitPrice")[1], "10");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    // 10 of 20 — the invalid row contributed nothing, so the bar has not moved.
    expect(screen.getByTestId("accounted-bar")).toHaveClass("bg-amber");
    // Nor the preview request: the invalid row must never reach `mutate`, only
    // the one valid buy of 10@20.
    await waitFor(() =>
      expect(previewMutate).toHaveBeenCalledWith([
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
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    const dateInput = screen.getAllByTestId("lot-date")[1];
    await user.clear(dateInput);
    await user.type(screen.getAllByTestId("lot-quantity")[1], "5");
    await user.type(screen.getAllByTestId("lot-unitPrice")[1], "10");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    // 10 of 20 — the dateless row contributed nothing, so the bar has not moved.
    expect(screen.getByTestId("accounted-bar")).toHaveClass("bg-amber");
  });

  // Over-recording is information, not an error: a user may enter a sale before
  // the buy it came from.
  it("keeps Save enabled when the bar is red", async () => {
    const user = userEvent.setup();
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[0], "50");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "10");
    expect(screen.getByTestId("accounted-bar")).toHaveClass("bg-red");
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("sends adds and deletes in one batch", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={onClose} />);

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
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      adds: [{ type: "sell", date: "2024-06-02", quantity: "5", unitPrice: "18" }],
      deletes: ["a"],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("sends the fee with a saved lot", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    txns = [];
    render(<RecordLotsModal holding={holding} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /add entry/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[0], "2");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "98.37");
    await user.type(screen.getAllByTestId("lot-fee")[0], "1.05");

    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const saved = mutateAsync.mock.calls[0][0];
    expect(saved.adds[0]).toMatchObject({ quantity: "2", unitPrice: "98.37", fee: "1.05" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("reads a French decimal comma", async () => {
    await i18n.changeLanguage("fr");
    const user = userEvent.setup();
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /ajouter une opération/i }));
    const frDateInput = screen.getAllByTestId("lot-date")[0];
    await user.clear(frDateInput);
    await user.type(frDateInput, "2024-06-02");
    await user.type(screen.getAllByTestId("lot-quantity")[0], "20");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "15,617");
    await user.click(screen.getByRole("button", { name: /enregistrer/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        adds: [{ type: "buy", date: "2024-06-02", quantity: "20", unitPrice: "15.617" }],
        deletes: [],
      }),
    );
  });

  it("sends a changed saved row as a delete + re-add in one batch, and counts it as one entry", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={onClose} />);

    const qtyInput = screen.getAllByTestId("lot-quantity")[0];
    await user.clear(qtyInput);
    await user.type(qtyInput, "12");

    expect(screen.getByRole("button", { name: /save 1 entry/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      adds: [{ type: "buy", date: "2024-05-02", quantity: "12", unitPrice: "20", fee: "0" }],
      deletes: ["a"],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("leaves Save disabled and sends nothing when a saved row is edited then reverted", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);

    const qtyInput = screen.getAllByTestId("lot-quantity")[0];
    await user.clear(qtyInput);
    await user.type(qtyInput, "12");
    expect(screen.getByRole("button", { name: /save 1 entry/i })).toBeEnabled();

    await user.clear(qtyInput);
    await user.type(qtyInput, "10");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // The server picks its own decimal scale, so a PEA lot comes back as "16.030"
  // while the user retypes the same price as "16.03". Treating that as an edit
  // would burn the row's id on a delete + re-add that changes nothing, and count
  // a phantom entry on the Save button.
  it("does not treat a retyped equivalent decimal as a change", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10.00", "16.030")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    const price = screen.getAllByTestId("lot-unitPrice")[0];
    await user.clear(price);
    await user.type(price, "16.03");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps Save disabled when an edit to a saved row makes it invalid", async () => {
    const user = userEvent.setup();
    txns = [lot("a", "buy", "10", "20")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);

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
    const { rerender } = render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);

    const qtyInput = screen.getAllByTestId("lot-quantity")[0];
    await user.clear(qtyInput);
    await user.type(qtyInput, "17");

    // A new array reference with the same underlying row — simulates a
    // background refetch completing while the user is mid-edit.
    txns = [lot("a", "buy", "10", "20")];
    rerender(<RecordLotsModal holding={{ ...holding }} onClose={vi.fn()} />);

    expect(screen.getAllByTestId("lot-quantity")[0]).toHaveValue("17");
  });

  it("keeps the modal open and reports the error when the save fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mutateAsync.mockRejectedValue(new Error("boom"));
    render(<RecordLotsModal holding={holding} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    const failDateInput = screen.getAllByTestId("lot-date")[0];
    await user.clear(failDateInput);
    await user.type(failDateInput, "2024-06-02");
    await user.type(screen.getAllByTestId("lot-quantity")[0], "5");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "10");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument());
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

    it("keeps suggestions out of the table and off the Save button until added", () => {
      txns = [lot("a", "buy", "10", "20")];
      suggestions = [suggestion];
      render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      expect(screen.getByRole("region", { name: "1 purchase found in your transactions" })).toBeInTheDocument();
      expect(screen.getAllByTestId("lot-row")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("adds a suggestion as an editable row in date order, and saves it unchanged", async () => {
      txns = [lot("a", "buy", "10", "20")];
      suggestions = [{ ...suggestion, date: "2024-01-03" }];
      const user = userEvent.setup();
      render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.queryByRole("region", { name: /found in your transactions/ })).not.toBeInTheDocument();
      expect(screen.getAllByTestId("lot-date").map((d) => (d as HTMLInputElement).value)).toEqual(["2024-01-03", "2024-05-02"]);
      await user.click(screen.getByRole("button", { name: "Save 1 entry" }));
      expect(mutateAsync).toHaveBeenCalledWith({
        adds: [{ type: "buy", date: "2024-01-03", quantity: "23", unitPrice: "6.35521739", fee: "0" }],
        deletes: [],
      });
    });

    it("adds them all at once, and puts a binned one back in the panel", async () => {
      suggestions = [suggestion, { ...suggestion, date: "2026-10-09" }];
      const user = userEvent.setup();
      render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Add all" }));
      expect(screen.getAllByTestId("lot-row")).toHaveLength(2);
      await user.click(screen.getAllByRole("button", { name: /delete entry/i })[0]);
      expect(screen.getByRole("region", { name: "1 purchase found in your transactions" })).toBeInTheDocument();
      expect(screen.getAllByTestId("lot-row")).toHaveLength(1);
    });

    it("hides the panel on Dismiss without adding anything", async () => {
      suggestions = [suggestion];
      const user = userEvent.setup();
      render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("region", { name: /found in your transactions/ })).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("lot-row")).toHaveLength(0);
    });

    it("still shows the saved lots when suggestions fail to load", () => {
      txns = [lot("a", "buy", "10", "20")];
      suggestionsFailed = true;
      render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
      expect(screen.getAllByTestId("lot-row")).toHaveLength(1);
    });
  });
});
