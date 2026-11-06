import { describe, it, expect } from "vitest";
import { DEFAULT_PREFS } from "../api/wire";
import { withPatch } from "./prefsPatch";

describe("withPatch", () => {
  it("removes the avatar on null", () => {
    expect(withPatch({ ...DEFAULT_PREFS, avatar: "data:image/webp;base64,A" }, { avatar: null })).toEqual(DEFAULT_PREFS);
  });
});
