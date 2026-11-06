import { useQuery } from "@tanstack/react-query";
import { getJson } from "./client";
import { keys } from "./keys";

export type Health = { status: string; version: string };

export function useHealth() {
  return useQuery({
    queryKey: keys.health(),
    // The version cannot change without a page reload, so never refetch it.
    queryFn: ({ signal }) => getJson<Health>(`/health`, { signal }),
    staleTime: Infinity,
  });
}
