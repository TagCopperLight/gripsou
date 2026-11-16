import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";
import type { SetupReq } from "./wire";

export function useSetupStatus() {
  return useQuery({
    queryKey: keys.setupStatus(),
    queryFn: ({ signal }) => api("GET /setup", { signal }),
  });
}

export const setupApi = {
  create: (body: SetupReq) => api("POST /setup", { body }),
};
