import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BackupCodes } from "./BackupCodes";

const CODES = ["aaaa-1111", "bbbb-2222", "cccc-3333"];

describe("BackupCodes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the codes one per line and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BackupCodes codes={CODES} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("aaaa-1111\nbbbb-2222\ncccc-3333");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("downloads the codes as a .txt file", async () => {
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return "blob:codes";
    });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<BackupCodes codes={CODES} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    const clicked = click.mock.contexts[0] as HTMLAnchorElement;
    expect(clicked.href).toBe("blob:codes");
    expect(clicked.download).toMatch(/\.txt$/);
    expect(blob?.type).toBe("text/plain");
    const text = await blob!.text();
    for (const c of CODES) expect(text).toContain(c);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:codes"), { timeout: 2000 });
  });
});
