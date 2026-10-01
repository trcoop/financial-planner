import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/theme.css'
import './index.css'
import App from './App.tsx'
import { AsOfProvider } from './ui/AsOfContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AsOfProvider>
      <App />
    </AsOfProvider>
  </StrictMode>,
)
