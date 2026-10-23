import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, storedTheme } from './lib/theme'
import './index.css'

// Before the first paint, so a dark window never flashes light.
applyTheme(storedTheme())

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
