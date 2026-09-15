import { act, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { RecordLotsModal } from "./RecordLotsModal";
import type { BasisPreview, Holding, Lot } from "../api/types";
import type { SaveLotAdd } from "../api/hooks";

const mutateAsync = vi.fn();
let txns: Lot[] = [];

// Fixed sentinel responses for the mocked preview endpoint. Deliberately NOT a
// reimplementation of the basis formula (that was the bug in fix round 1:
// wrong, fee-blind, and it let a test assert only that the UI echoes what the
// test itself computed). These prove the plumbing — the row set reaching the
// server and the figures the server sends back reaching the screen — and
// nothing about the formula, which only the backend may compute.
const PREVIEW_RESULTS: BasisPreview[] = [
  { meanPrice: "25", invested: "375", realised: "0", unrealised: "12" },
  { meanPrice: "30", invested: "400", realised: "5", unrealised: "20" },
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
          // An incidental extra call with no rows can land before the seeded
          // rows' debounced call does (mount timing) — it must not consume a
          // sentinel slot the assertions below are counting on.
          const result =
            rows.length === 0
              ? { meanPrice: "0", invested: "0", realised: "0", unrealised: "0" }
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
  ticker: "ESE",
  name: "BNP Easy S&P 500",
  logo: null,
  accountName: "PEA",
  accountColor: "#34d399",
  accountType: "pea",
  accountTypeLabel: "PEA",
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

  it("shows only user-entered rows", () => {
    txns = [lot("a", "buy", "10", "20"), { ...lot("b", "buy", "5", "20"), manual: false }];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    expect(screen.getAllByTestId("lot-row")).toHaveLength(1);
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
    // The mount fires an initial (empty-rows) preview before the seeded rows'
    // debounced call lands, so wait for the CALL with the real rows first —
    // the sentinel is the same regardless of rows, so asserting on the figure
    // text alone would pass too early.
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
    await user.click(screen.getByRole("button", { name: /add purchase/i }));
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
    await user.click(screen.getByRole("button", { name: /add purchase/i }));
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
    await user.click(screen.getByRole("button", { name: /add purchase/i }));
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
    await user.click(screen.getByRole("button", { name: /add purchase/i }));
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
    await user.click(screen.getByRole("button", { name: /add sale/i }));
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

    await user.click(screen.getByRole("button", { name: /add purchase/i }));
    await user.type(screen.getAllByTestId("lot-quantity")[0], "2");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "104.74");
    await user.type(screen.getAllByTestId("lot-fee")[0], "1.05");

    await user.click(screen.getByRole("button", { name: /save 1 entry/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const saved = mutateAsync.mock.calls[0][0];
    expect(saved.adds[0]).toMatchObject({ quantity: "2", unitPrice: "104.74", fee: "1.05" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("reads a French decimal comma", async () => {
    await i18n.changeLanguage("fr");
    const user = userEvent.setup();
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /ajouter un achat/i }));
    const frDateInput = screen.getAllByTestId("lot-date")[0];
    await user.clear(frDateInput);
    await user.type(frDateInput, "2024-06-02");
    await user.type(screen.getAllByTestId("lot-quantity")[0], "20");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "16,029");
    await user.click(screen.getByRole("button", { name: /enregistrer/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        adds: [{ type: "buy", date: "2024-06-02", quantity: "20", unitPrice: "16.029" }],
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
    await user.click(screen.getByRole("button", { name: /add purchase/i }));
    const failDateInput = screen.getAllByTestId("lot-date")[0];
    await user.clear(failDateInput);
    await user.type(failDateInput, "2024-06-02");
    await user.type(screen.getAllByTestId("lot-quantity")[0], "5");
    await user.type(screen.getAllByTestId("lot-unitPrice")[0], "10");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
