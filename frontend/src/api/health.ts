import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function useHealth() {
  return useQuery({
    queryKey: keys.health(),
    // The version only changes with a page reload.
    queryFn: ({ signal }) => api("GET /health", { signal }),
    staleTime: Infinity,
  });
}
