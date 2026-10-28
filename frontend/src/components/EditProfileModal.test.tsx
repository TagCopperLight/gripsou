import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditProfileModal } from "./EditProfileModal";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS, type UserPrefs } from "../lib/prefs";
import { fileToAvatarDataUrl } from "../lib/avatar";

vi.mock("../lib/avatar", () => ({
  fileToAvatarDataUrl: vi.fn(async () => "data:image/webp;base64,NEW"),
}));

const user = { id: "u1", name: "Jules", email: "jules@gripsou.local", role: "admin" as const, prefs: DEFAULT_PREFS, welcomeDone: true };

function renderModal(prefs: UserPrefs = DEFAULT_PREFS) {
  const onClose = vi.fn();
  const updateUser = vi.fn();
  const updatePrefs = vi.fn(async () => {});
  const auth: AuthValue = {
    isAuthenticated: true,
    user: { ...user, prefs },
    isBootstrapping: false,
    prefs,
    login: vi.fn(),
    loginWithPasskey: vi.fn(),
    verifyLogin: vi.fn(),
    adoptSession: () => {},
    logout: vi.fn(),
    updateUser,
    updatePrefs,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <EditProfileModal onClose={onClose} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose, updateUser, updatePrefs };
}

const save = () => screen.getByRole("button", { name: "Save changes" });
const fileInput = (container: HTMLElement) =>
  container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;

afterEach(() => vi.unstubAllGlobals());

describe("EditProfileModal", () => {
  it("starts from the current name and email, with Save disabled", () => {
    renderModal();
    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Jules");
    expect(screen.getByLabelText("Email")).toHaveValue("jules@gripsou.local");
    expect(save()).toBeDisabled();
  });

  it("disables Save again when the edit is undone or invalid", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jules R" } });
    expect(save()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jules" } });
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jules" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    expect(save()).toBeDisabled();
  });

  it("patches /auth/me, updates the cached user, then closes", async () => {
    const updated = { ...user, name: "Jules Renamed" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(updated), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { onClose, updateUser } = renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Jules Renamed " } });
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateUser).toHaveBeenCalledWith(updated);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ method: "PATCH" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ name: "Jules Renamed", email: "jules@gripsou.local" });
  });

  it("says the email is in use on a 409 and stays open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("taken", { status: 409 })));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@gripsou.local" } });
    fireEvent.click(save());
    expect(await screen.findByText("Another account already uses this email.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says saving failed on any other error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jules R" } });
    fireEvent.click(save());
    expect(await screen.findByText("Couldn't save your profile")).toBeInTheDocument();
  });

  it("saves a picked picture into prefs right away", async () => {
    const { container, updatePrefs } = renderModal();
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    await waitFor(() =>
      expect(updatePrefs).toHaveBeenCalledWith({ avatar: "data:image/webp;base64,NEW" }),
    );
  });

  it("says so when a picked file can't be used as a picture", async () => {
    vi.mocked(fileToAvatarDataUrl).mockRejectedValueOnce(new Error("not an image"));
    const { container, updatePrefs } = renderModal();
    const file = new File(["x"], "broken.png", { type: "image/png" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    expect(await screen.findByText("That picture couldn't be used.")).toBeInTheDocument();
    expect(updatePrefs).not.toHaveBeenCalled();
  });

  it("only offers Remove when a picture is set", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("removes the picture", () => {
    const prefs = { ...DEFAULT_PREFS, avatar: "data:image/webp;base64,OLD" };
    const { updatePrefs } = renderModal(prefs);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(updatePrefs).toHaveBeenCalledWith({ avatar: null });
  });
});
