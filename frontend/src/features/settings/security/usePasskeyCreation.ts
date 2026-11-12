import { useRef } from "react";
import { startRegistration, WebAuthnAbortService } from "@simplewebauthn/browser";

import { ApiError } from "../../../api/client";
import { usePasskeyRegisterOptions, useRegisterPasskey } from "../../../api/auth";

export type PasskeyOutcome =
  | { kind: "added"; name: string }
  /** The password check is used up, or the browser window stayed open past
   *  the challenge's 5 minutes. */
  | { kind: "expired" }
  | { kind: "alreadyAdded" }
  | { kind: "notAdded" }
  | { kind: "cancelled" };

/** Adds a passkey through the browser's own window. `reauth` is the password
 *  check, left out during the welcome flow. */
export function usePasskeyCreation() {
  const options = usePasskeyRegisterOptions();
  const register = useRegisterPasskey();
  // Set by `cancel`, so a browser window still settling is ignored.
  const cancelled = useRef(false);

  const cancel = () => {
    cancelled.current = true;
    WebAuthnAbortService.cancelCeremony();
  };

  const create = async (reauth: string | undefined): Promise<PasskeyOutcome> => {
    cancelled.current = false;
    try {
      const { challenge, options: optionsJSON } = await options.mutateAsync(reauth);
      if (cancelled.current) return { kind: "cancelled" };
      const credential = await startRegistration({ optionsJSON });
      if (cancelled.current) return { kind: "cancelled" };
      const added = await register.mutateAsync({ reauth, challenge, credential });
      if (cancelled.current) return { kind: "cancelled" };
      return { kind: "added", name: added.name };
    } catch (err) {
      if (cancelled.current) return { kind: "cancelled" };
      if (err instanceof ApiError && (err.status === 403 || err.status === 410)) return { kind: "expired" };
      // The browser refuses a device that already holds one of the user's
      // passkeys (InvalidStateError); the server answers 409 for the same.
      const already =
        (err instanceof Error && err.name === "InvalidStateError") ||
        (err instanceof ApiError && err.status === 409);
      return { kind: already ? "alreadyAdded" : "notAdded" };
    }
  };

  return { create, cancel };
}
