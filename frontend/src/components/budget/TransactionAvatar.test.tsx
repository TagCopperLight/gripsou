import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TransactionAvatar } from "./TransactionAvatar";
import type { Transaction } from "../../api/types";

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1", t: 0, type: "withdrawal", description: "ALDI", amount: "-12.00",
    amountReporting: "-12.00",
    currency: "EUR", accountId: "a", accountName: "Current", accountColor: null,
    source: "cash", ticker: null, quantity: null, unitPrice: null, fee: null,
    categoryId: null, categoryName: null, categoryDefaultKey: null, categoryColor: null,
    categoryIcon: null, categoryKind: null, categorySource: null, categoryConfidence: null,
    needsReview: false, checked: false, isTransfer: false, isOrphanTransfer: false,
    merchantDomain: null, merchantLogoUrl: null, note: null, tags: [], ...over,
  };
}

describe("TransactionAvatar", () => {
  it("draws the category icon tinted with the category colour", () => {
    render(
      <TransactionAvatar
        tx={tx({ categoryId: "c1", categoryIcon: "shopping-cart", categoryColor: "#9bb06b" })}
      />,
    );
    const el = screen.getByTestId("tx-avatar");
    expect(el).toHaveAttribute("data-variant", "category");
    expect(el.style.color).toBe("rgb(155, 176, 107)");
  });

  it("falls back to a generic glyph when there is no category", () => {
    render(<TransactionAvatar tx={tx({})} />);
    expect(screen.getByTestId("tx-avatar")).toHaveAttribute("data-variant", "generic");
  });

  it("ignores an unsafe colour rather than putting it in a style attribute", () => {
    render(
      <TransactionAvatar
        tx={tx({ categoryId: "c1", categoryIcon: "wallet", categoryColor: "javascript:boom" })}
      />,
    );
    expect(screen.getByTestId("tx-avatar").style.color).toBe("rgb(174, 170, 167)");
  });

  it("shows the merchant logo when there is one", () => {
    render(<TransactionAvatar tx={{ ...tx(), merchantLogoUrl: "https://cdn.brandfetch.io/leclerc.fr/x" }} />);
    expect(screen.getByTestId("tx-avatar")).toHaveAttribute("data-variant", "merchant");
    expect(screen.getByRole("presentation")).toHaveAttribute("src", "https://cdn.brandfetch.io/leclerc.fr/x");
  });

  it("falls back to the category icon when the logo fails to load", () => {
    render(<TransactionAvatar tx={{ ...tx({ categoryId: "c1", categoryIcon: "shopping-cart", categoryColor: "#34d399" }),
      merchantLogoUrl: "https://cdn.brandfetch.io/nope.fr/x" }} />);
    fireEvent.error(screen.getByRole("presentation"));
    expect(screen.getByTestId("tx-avatar")).toHaveAttribute("data-variant", "category");
  });
});
