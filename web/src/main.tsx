import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './globals.css'
import Login from './pages/Login'

/**
 * The separated frontend: plain client-side JS, no server rendering, talking to
 * the existing API over /api. nginx serves this bundle and proxies /api to the
 * app container, so it is one origin and the session cookie keeps working
 * without CORS.
 *
 * Only the routes listed here belong to the SPA. Everything else is served by
 * the Next app, so leaving the SPA must be a full page load, not a router push.
 */
function Home() {
  useEffect(() => { location.replace('/') }, [])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
