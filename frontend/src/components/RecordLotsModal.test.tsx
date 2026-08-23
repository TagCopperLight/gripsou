import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { RecordLotsModal } from "./RecordLotsModal";
import type { Holding, Purchase } from "../api/types";

const mutateAsync = vi.fn();
let txns: Purchase[] = [];
vi.mock("../api/hooks", async () => {
  const actual = await vi.importActual<typeof import("../api/hooks")>("../api/hooks");
  return {
    ...actual,
    useSaveLots: () => ({ mutateAsync, isPending: false }),
    useHoldingTransactions: () => ({ data: txns, isError: false, refetch: vi.fn() }),
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

const lot = (id: string, type: "buy" | "sell", qty: string, price: string): Purchase => ({
  id,
  t: Date.parse("2024-05-02T00:00:00Z"),
  type,
  qty,
  price,
  invested: type === "buy" ? `-${Number(qty) * Number(price)}` : `${Number(qty) * Number(price)}`,
  manual: true,
});

describe("RecordLotsModal", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(undefined);
    txns = [];
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
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

  it("shows the resulting figures for the recorded rows", () => {
    txns = [lot("a", "buy", "10", "20"), lot("b", "buy", "10", "30"), lot("c", "sell", "5", "35")];
    render(<RecordLotsModal holding={holding} onClose={vi.fn()} />);
    // μ = 25 → invested 375, realised +50, unrealised 15×40 − 375 = 225.
    expect(screen.getByTestId("figure-meanPrice")).toHaveTextContent("25");
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("375");
    expect(screen.getByTestId("figure-realised")).toHaveTextContent("50");
    expect(screen.getByTestId("figure-unrealised")).toHaveTextContent("225");
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
    // Nor the figures: a lone valid buy of 10@20 has invested 200, mean price 20.
    expect(screen.getByTestId("figure-invested")).toHaveTextContent("200");
    expect(screen.getByTestId("figure-meanPrice")).toHaveTextContent("20");
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
      adds: [{ type: "buy", date: "2024-05-02", quantity: "12", unitPrice: "20" }],
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
