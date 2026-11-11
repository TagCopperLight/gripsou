import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";
import type { SetupReq } from "./wire";

/** Whether the server has no account yet, so its first one is made at /setup. */
export function useSetupStatus() {
  return useQuery({
    queryKey: keys.setupStatus(),
    queryFn: ({ signal }) => api("GET /setup", { signal }),
  });
}

export const setupApi = {
  create: (body: SetupReq) => api("POST /setup", { body }),
};
