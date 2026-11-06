import { it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ResetLinkModal } from "./ResetLinkModal";
import type { User } from "../../../api/types";
import { renderWithApp, stubFetch } from "../../../test/kit";

const MARIE: User = {
  id: "u2", name: "Marie Laurent", email: "marie@gripsou.local", role: "user", joinedAt: 0, isSelf: false,
};

it("asks for the password, then shows the link made with the reauth token", async () => {
  const fetchMock = stubFetch(async (url, init) => {
    if (url === "/api/auth/reauth") {
      const { password } = JSON.parse(init!.body as string) as { password: string };
      return password === "right"
        ? Response.json({ reauth: "proof" })
        : new Response("password is incorrect", { status: 400 });
    }
    return Response.json({ token: "tok" }, { status: 201 });
  });
  renderWithApp(<ResetLinkModal user={MARIE} onClose={() => {}} />);
  const user = userEvent.setup();
  const field = screen.getByLabelText("Current password");

  await user.type(field, "wrong{Enter}");
  expect(await screen.findByText("Wrong password.")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => url.includes("reset-link"))).toBe(false);

  await user.clear(field);
  await user.type(field, "right{Enter}");
  expect(await screen.findByText(`${window.location.origin}/reset/tok`)).toBeInTheDocument();
  const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/users/u2/reset-link")!;
  expect(JSON.parse(init!.body as string)).toEqual({ reauth: "proof" });
});
