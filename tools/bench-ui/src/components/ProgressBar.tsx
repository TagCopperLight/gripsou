export function ProgressBar({ value, small }: { value: number | null; small?: boolean }) {
  return (
    <div className={`bar${small ? ' bar-small' : ''}${value === null ? ' bar-indeterminate' : ''}`}>
      {value !== null && <i style={{ width: `${Math.round(value * 100)}%` }} />}
    </div>
  )
}
