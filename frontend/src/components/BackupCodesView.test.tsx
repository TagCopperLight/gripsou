import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BackupCodesView } from "./BackupCodesView";

describe("BackupCodesView", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lists the codes with the warning", () => {
    render(<BackupCodesView codes={["a-1", "b-2"]} />);
    expect(screen.getByText("a-1")).toBeInTheDocument();
    expect(screen.getByText("b-2")).toBeInTheDocument();
    expect(screen.getByText(/Each code works once/)).toBeInTheDocument();
  });

  it("copies the codes one per line, then says Copied for two seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BackupCodesView codes={["a-1", "b-2"]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledWith("a-1\nb-2");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("downloads a text file and releases the object URL", () => {
    const create = vi.fn<(blob: Blob) => string>(() => "blob:codes");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("gripsou-backup-codes.txt");
      expect(this.href).toBe("blob:codes");
    });
    render(<BackupCodesView codes={["a-1", "b-2"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    const blob = create.mock.calls[0][0];
    expect(blob.type).toBe("text/plain");
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:codes");
  });
});
