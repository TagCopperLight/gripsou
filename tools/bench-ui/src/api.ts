import { QueryClient, useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Catalog, CompareResult, Health, Job, Label, RunOptions, RunSet, RunSummary } from '../shared/types'

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`)
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const useCatalog = () => useQuery({ queryKey: ['catalog'], queryFn: () => call<Catalog>('GET', '/api/catalog'), staleTime: Infinity })
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => call<Health>('GET', '/api/health'), refetchInterval: 30000 })
export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: () => call<RunSummary[]>('GET', '/api/runs') })

type Loaded = { set: RunSet; label: Label | null }
export function useRunSets(ids: string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: ['run', id], queryFn: () => call<Loaded>('GET', `/api/runs/${id}`), staleTime: Infinity })),
  })
  const data: Record<string, Loaded> = {}
  results.forEach((r, i) => {
    if (r.data) data[ids[i]] = r.data
  })
  return { data, isLoading: results.some((r) => r.isLoading) }
}

/** Live job list over SSE; refreshes the run list when a job reaches a final state. */
export function useJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([])
  useEffect(() => {
    const source = new EventSource('/api/events')
    let finished = ''
    source.addEventListener('jobs', (e) => {
      const list = JSON.parse((e as MessageEvent<string>).data) as Job[]
      setJobs(list)
      const done = list.filter((j) => j.status === 'saved').map((j) => j.id).join()
      if (done !== finished) {
        finished = done
        void queryClient.invalidateQueries({ queryKey: ['runs'] })
      }
    })
    return () => source.close()
  }, [])
  return jobs
}

export const startJob = (o: RunOptions) => call<Job>('POST', '/api/jobs', o)
export const cancelJob = (id: string) => call<void>('DELETE', `/api/jobs/${id}`)
export async function renameRun(id: string, patch: { name?: string; note?: string }) {
  await call<void>('PATCH', `/api/runs/${id}`, patch)
  await queryClient.invalidateQueries({ queryKey: ['runs'] })
  await queryClient.invalidateQueries({ queryKey: ['run', id] })
}
export async function deleteRun(id: string) {
  await call<void>('DELETE', `/api/runs/${id}`)
  queryClient.removeQueries({ queryKey: ['run', id] })
  await queryClient.invalidateQueries({ queryKey: ['runs'] })
}
export const fetchCompare = (reference: string, others: string[]) =>
  call<Record<string, CompareResult>>('POST', '/api/compare', { reference, others })
