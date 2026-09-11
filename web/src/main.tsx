import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './globals.css'
import Shell from './Shell'
import Login from './pages/Login'
import Mml from './pages/Mml'

/**
 * The separated frontend: plain client-side JS, no server rendering, talking to
 * the existing API over /api. nginx serves this bundle and proxies /api to the
 * app container, so it is one origin and the session cookie keeps working
 * without CORS.
 *
 * Only the routes listed here belong to the SPA. Everything else is still
 * served by the Next app, so nothing is broken while the port continues.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route path="/mml" element={<Mml />} />
        </Route>
        <Route path="*" element={<Navigate to="/mml" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
