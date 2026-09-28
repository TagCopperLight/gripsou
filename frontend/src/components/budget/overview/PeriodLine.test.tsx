import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PeriodLine } from "./PeriodLine";
import { BudgetProvider } from "../BudgetProvider";
import { useBudget } from "../budgetContext";
import type { Period } from "../../../lib/period";

function Probe() {
  const { period } = useBudget();
  return <span data-testid="period">{JSON.stringify(period)}</span>;
}

/** The line shows the context's period once one is picked, like the page. */
function Line(props: Partial<Parameters<typeof PeriodLine>[0]>) {
  const { period } = useBudget();
  const shown: Period = period ?? { mode: "month", month: "2026-08" };
  return (
    <PeriodLine
      period={shown}
      txnCount={412}
      fxMissing={false}
      canStepBack
      canStepForward
      onStep={() => {}}
      {...props}
    />
  );
}

function renderLine(props: Partial<Parameters<typeof PeriodLine>[0]> = {}) {
  render(
    <BudgetProvider>
      <Probe />
      <Line {...props} />
    </BudgetProvider>,
  );
}

describe("PeriodLine", () => {
  it("names the month and counts its transactions", () => {
    renderLine();
    expect(screen.getByTestId("period-label")).toHaveTextContent("August 2026");
    expect(screen.getByTestId("period-count")).toHaveTextContent("412");
  });

  it("steps through the caller, one month either way", () => {
    const onStep = vi.fn();
    renderLine({ onStep });
    fireEvent.click(screen.getByTestId("period-prev"));
    fireEvent.click(screen.getByTestId("period-next"));
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
  });

  it("disables each caret at the edge of the data the caller reports", () => {
    renderLine({ canStepBack: false, canStepForward: false });
    expect(screen.getByTestId("period-prev")).toBeDisabled();
    expect(screen.getByTestId("period-next")).toBeDisabled();
  });

  it("shows the FX warning only when a row could not be valued", () => {
    renderLine();
    expect(screen.queryByTestId("period-fx-missing")).toBeNull();
    renderLine({ fxMissing: true });
    expect(screen.getAllByTestId("period-fx-missing")[0]).toBeVisible();
  });

  it("replaces the stepper with the range and a clearing cross under a range", () => {
    renderLine();
    fireEvent.click(screen.getByTestId("period-range"));
    fireEvent.click(screen.getByText("Last 3 months"));
    expect(screen.queryByTestId("period-prev")).toBeNull();
    expect(screen.getByTestId("period-clear")).toBeVisible();
    expect(screen.getByTestId("period")).toHaveTextContent('"mode":"range"');
  });

  it("returns to the default period when the range is cleared", () => {
    renderLine();
    fireEvent.click(screen.getByTestId("period-range"));
    fireEvent.click(screen.getByText("Last 3 months"));
    fireEvent.click(screen.getByTestId("period-clear"));
    // No pick left: the page falls back to the latest month with data.
    expect(screen.getByTestId("period")).toHaveTextContent("null");
    expect(screen.getByTestId("period-prev")).toBeVisible();
  });
});
