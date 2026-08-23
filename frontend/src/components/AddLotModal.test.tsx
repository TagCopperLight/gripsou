import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import i18n from "../i18n";
import { AddLotModal } from "./AddLotModal";
import type { Holding } from "../api/types";

const mutateAsync = vi.fn();
vi.mock("../api/hooks", async () => {
  const actual = await vi.importActual<typeof import("../api/hooks")>("../api/hooks");
  return { ...actual, useAddLot: () => ({ mutateAsync, isPending: false }) };
});

const holding = {
  id: "h1",
  ticker: "ESE",
  name: "BNP Easy S&P 500",
  unexplainedQty: "70",
} as Holding;

describe("AddLotModal", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("submits one row per lot, deriving nothing the user did not enter", async () => {
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantity/i), "20");
    await userEvent.type(screen.getByLabelText(/unit price/i), "16.029");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        date: "2024-05-02",
        quantity: "20",
        unitPrice: "16.029",
      }),
    );
  });

  it("adds a second lot row on demand", async () => {
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /add another/i }));
    expect(screen.getAllByLabelText(/quantity/i)).toHaveLength(2);
  });

  it("does not close the modal when a lot fails to save", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("POST failed: 400"));
    const onClose = vi.fn();
    render(<AddLotModal holding={holding} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantity/i), "20");
    await userEvent.type(screen.getByLabelText(/unit price/i), "16.029");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/could not save/i)).toBeInTheDocument();
  });

  it("retries only the failed row after a partial failure, never resubmitting a saved one", async () => {
    // Row 0 saves fine; row 1 fails. On retry, only row 1's (corrected) values
    // must be sent — row 0 must not be submitted a second time. Manual lots
    // have external_id = null, so the server has no dedup for them: a repeat
    // submission of an already-saved row would silently double the position.
    mutateAsync.mockImplementation(async (lot: { quantity: string }) => {
      if (lot.quantity === "999") throw new Error("POST failed: 400");
    });
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);

    await userEvent.type(screen.getAllByLabelText(/date/i)[0], "2024-05-02");
    await userEvent.type(screen.getAllByLabelText(/quantity/i)[0], "20");
    await userEvent.type(screen.getAllByLabelText(/unit price/i)[0], "16.029");

    await userEvent.click(screen.getByRole("button", { name: /add another/i }));
    await userEvent.type(screen.getAllByLabelText(/date/i)[1], "2024-06-01");
    await userEvent.type(screen.getAllByLabelText(/quantity/i)[1], "999");
    await userEvent.type(screen.getAllByLabelText(/unit price/i)[1], "10");

    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/could not save/i)).toBeInTheDocument();

    mutateAsync.mockClear();
    mutateAsync.mockImplementation(async () => undefined);

    // Correct the failing row and retry.
    await userEvent.clear(screen.getAllByLabelText(/quantity/i)[1]);
    await userEvent.type(screen.getAllByLabelText(/quantity/i)[1], "5");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ date: "2024-05-02", quantity: "20" }),
    );
    expect(mutateAsync).toHaveBeenCalledWith({
      date: "2024-06-01",
      quantity: "5",
      unitPrice: "10",
    });
  });

  it("normalises a comma decimal separator to a dot before sending (FR keyboards)", async () => {
    await i18n.changeLanguage("fr");
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantit/i), "20");
    await userEvent.type(screen.getByLabelText(/prix unitaire/i), "16,03");
    await userEvent.click(screen.getByRole("button", { name: /enregistrer/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        date: "2024-05-02",
        quantity: "20",
        unitPrice: "16.03",
      }),
    );
  });

  it("keeps a three-decimal comma price intact (16,029 is a real unit price, not grouping)", async () => {
    await i18n.changeLanguage("fr");
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantit/i), "20");
    await userEvent.type(screen.getByLabelText(/prix unitaire/i), "16,029");
    await userEvent.click(screen.getByRole("button", { name: /enregistrer/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        date: "2024-05-02",
        quantity: "20",
        unitPrice: "16.029",
      }),
    );
  });

  it("refuses a comma under a non-FR locale rather than silently misreading it", async () => {
    // Under `en` a comma is a thousands separator, so "1,234" could mean 1234.
    // Reading it as 1.234 would post a value 1000x off in silence; refusing it
    // tells the user instead. The FR tests above cover the decimal-comma case.
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantity/i), "20");
    await userEvent.type(screen.getByLabelText(/unit price/i), "1,234");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByText(/enter a valid number/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // Grouped input is ambiguous, so it must be refused rather than guessed at:
  // silently reading "1.234,56" as a decimal would post a value 1000x off.
  it.each(["1.234,56", "1,234,56"])(
    "refuses grouped number input (%s) instead of guessing",
    async (grouped) => {
      render(<AddLotModal holding={holding} onClose={vi.fn()} />);
      await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
      await userEvent.type(screen.getByLabelText(/quantity/i), "20");
      await userEvent.type(screen.getByLabelText(/unit price/i), grouped);
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      expect(screen.getByText(/enter a valid number/i)).toBeInTheDocument();
      expect(mutateAsync).not.toHaveBeenCalled();
    },
  );

  it("rejects a quantity that is not a valid number without calling the API", async () => {
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantity/i), "abc");
    await userEvent.type(screen.getByLabelText(/unit price/i), "16.03");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByText(/enter a valid number/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity without calling the API", async () => {
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantity/i), "0");
    await userEvent.type(screen.getByLabelText(/unit price/i), "16.03");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("rejects a negative unit price without calling the API", async () => {
    render(<AddLotModal holding={holding} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantity/i), "20");
    await userEvent.type(screen.getByLabelText(/unit price/i), "-1");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByText(/cannot be negative/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("closes the modal once every row has saved", async () => {
    const onClose = vi.fn();
    render(<AddLotModal holding={holding} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/date/i), "2024-05-02");
    await userEvent.type(screen.getByLabelText(/quantity/i), "20");
    await userEvent.type(screen.getByLabelText(/unit price/i), "16.029");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
