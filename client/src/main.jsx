import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startPwaUpdateWatcher } from './pwaUpdate.js'
import { startPwaInstallCapture } from './pwaInstall.js'
import { installInputGuards } from './utils/inputGuards.js'

installInputGuards()
startPwaInstallCapture()
startPwaUpdateWatcher()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
