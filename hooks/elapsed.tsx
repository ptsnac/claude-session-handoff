import type { ClientModule } from 'claude-code'

// The session timer, ticking on the surface's own clock so the band is not
// redrawn every second (a redraw restarts what else animates in the band).

type Props = { startedAt: number; now: number }
type State = { now: number; ticks: number }

const pad = (n: number) => String(n).padStart(2, '0')

const format = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`
}

const Elapsed: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const state = surface.state
  if (state === undefined) {
    surface.every(1000, () => {
      const current = surface.state
      if (current) surface.setState({ ...current, ticks: current.ticks + 1 })
    })
  }
  // A redraw of the band hands over the hook's own clock: count on from it.
  if (state === undefined || state.now !== props.now) {
    surface.setState({ now: props.now, ticks: 0 })
  }
  const ticks = state !== undefined && state.now === props.now ? state.ticks : 0

  return (
    <Text>
      <Text dimColor>session </Text>
      <Text bold>{format(props.now - props.startedAt + ticks * 1000)}</Text>
    </Text>
  )
}

export default Elapsed
