import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { showError, useErrorToast } from "./errorToasts";

function Failing({ message }: { message: string | null }) {
  useErrorToast(message);
  return null;
}

describe("error toasts", () => {
  it("shows the same failure once, however many times it happens", () => {
    act(() => {
      showError("Nothing was saved");
      showError("Nothing was saved");
    });
    expect(screen.getAllByTestId("error-toast")).toHaveLength(1);
  });

  it("goes away by itself after 5 seconds", () => {
    vi.useFakeTimers();
    try {
      act(() => void showError("Nothing was saved"));
      act(() => vi.advanceTimersByTime(4900));
      expect(screen.getByTestId("error-toast")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(100));
      expect(screen.queryByTestId("error-toast")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes when the action is tried again, but outlives the window that failed", () => {
    const { rerender, unmount } = render(<Failing message="Nothing was saved" />);
    expect(screen.getByTestId("error-toast")).toHaveTextContent("Nothing was saved");
    rerender(<Failing message={null} />);
    expect(screen.queryByTestId("error-toast")).toBeNull();
    rerender(<Failing message="Nothing was saved" />);
    unmount();
    expect(screen.getByTestId("error-toast")).toBeInTheDocument();
  });
});
