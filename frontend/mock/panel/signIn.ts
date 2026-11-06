// Signs in on the first visit only, so signing out (to review the login
// screen) sticks across reloads. Loaded before the app's own module, which
// shares this client and so starts with the token.

import { setAuthToken } from "../../src/api/client.ts";

const STARTED_KEY = "gripsou.mock.started";

if (!localStorage.getItem(STARTED_KEY)) {
  localStorage.setItem(STARTED_KEY, "1");
  setAuthToken("mock", true);
}
