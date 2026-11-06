import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function useHealth() {
  return useQuery({
    queryKey: keys.health(),
    // The version cannot change without a page reload, so never refetch it.
    queryFn: ({ signal }) => api("GET /health", { signal }),
    staleTime: Infinity,
  });
}
