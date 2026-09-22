import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PeriodLine } from "./PeriodLine";
import { BudgetProvider } from "../BudgetProvider";
import { useBudget } from "../budgetContext";
import { currentMonth, addMonths } from "../../../lib/period";

function Probe() {
  const { period } = useBudget();
  return <span data-testid="period">{JSON.stringify(period)}</span>;
}

function renderLine(props: Partial<Parameters<typeof PeriodLine>[0]> = {}) {
  render(
    <BudgetProvider>
      <Probe />
      <PeriodLine txnCount={412} fxMissing={false} canStepBack {...props} />
    </BudgetProvider>,
  );
}

describe("PeriodLine", () => {
  it("names the current month and counts its transactions", () => {
    renderLine();
    expect(screen.getByTestId("period-label")).toHaveTextContent(/\d{4}/);
    expect(screen.getByTestId("period-count")).toHaveTextContent("412");
  });

  it("disables the forward caret on the current month", () => {
    renderLine();
    expect(screen.getByTestId("period-next")).toBeDisabled();
  });

  it("enables the forward caret once the period is in the past", () => {
    renderLine();
    fireEvent.click(screen.getByTestId("period-prev"));
    expect(screen.getByTestId("period-next")).toBeEnabled();
  });

  it("steps the period backward", () => {
    renderLine();
    fireEvent.click(screen.getByTestId("period-prev"));
    expect(screen.getByTestId("period")).toHaveTextContent(addMonths(currentMonth(), -1));
  });

  it("disables the back caret when the caller says the data has run out", () => {
    renderLine({ canStepBack: false });
    expect(screen.getByTestId("period-prev")).toBeDisabled();
  });

  it("shows the FX warning only when a row could not be valued", () => {
    renderLine();
    expect(screen.queryByTestId("period-fx-missing")).toBeNull();

    render(
      <BudgetProvider>
        <PeriodLine txnCount={412} fxMissing canStepBack />
      </BudgetProvider>,
    );
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

  it("returns to month mode when the range is cleared", () => {
    renderLine();
    fireEvent.click(screen.getByTestId("period-range"));
    fireEvent.click(screen.getByText("Last 3 months"));
    fireEvent.click(screen.getByTestId("period-clear"));
    expect(screen.getByTestId("period")).toHaveTextContent(`"month":"${currentMonth()}"`);
    expect(screen.getByTestId("period-prev")).toBeVisible();
  });
});
