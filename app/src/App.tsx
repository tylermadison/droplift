import { tinyHost } from './host-api'
import { SetupScreen } from './setup/SetupScreen'

export default function App() {
  return <SetupScreen host={tinyHost} />
}
