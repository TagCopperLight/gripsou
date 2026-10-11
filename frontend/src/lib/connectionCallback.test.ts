import { describe, it, expect } from "vitest";
import { parseCallbackParams } from "./connectionCallback";

describe("parseCallbackParams", () => {
  it("takes the state as the connection id and keeps the rest", () => {
    expect(parseCallbackParams("?state=c42&code=abc&connection_id=7")).toEqual({
      connectionId: "c42",
      rest: { code: "abc", connection_id: "7" },
    });
  });

  it("keeps the provider's error in the rest", () => {
    expect(parseCallbackParams("state=c1&error=access_denied")).toEqual({
      connectionId: "c1",
      rest: { error: "access_denied" },
    });
  });

  it("accepts the query with or without the leading question mark", () => {
    expect(parseCallbackParams("state=c1")).toEqual(parseCallbackParams("?state=c1"));
  });

  it("has no connection id without a state", () => {
    expect(parseCallbackParams("?code=abc")).toEqual({ connectionId: null, rest: { code: "abc" } });
    expect(parseCallbackParams("")).toEqual({ connectionId: null, rest: {} });
  });
});
