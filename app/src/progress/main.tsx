// Entry of the progress window (its own HTML file: a #hash page does not load in a second window, spike 03).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './progress.css'
import { ProgressWindow, type ProgressSource } from './ProgressWindow'

// The tinyjs guide says tiny.api.on returns an unsubscribe function; its type file says void.
const source: ProgressSource = {
  onProgress: (fn) => {
    const off = tiny.api.on('progress', fn) as unknown
    return () => void (typeof off === 'function' && off())
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProgressWindow source={source} />
  </StrictMode>,
)
