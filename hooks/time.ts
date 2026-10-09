const pad = (n: number) => String(n).padStart(2, '0')

export const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`
}

export const formatAge = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)

  return minutes < 1 ? 'just now' : `${minutes}m ago`
}

export const fileStamp = (ms: number) => {
  const d = new Date(ms)

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}
