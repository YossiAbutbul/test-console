import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ThemeModeProvider } from './context/ThemeModeContext'
import { ConnectionProvider } from './context/ConnectionContext'
import { LogProvider } from './context/LogContext'
import { InstrumentsProvider } from './context/InstrumentsContext'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <BrowserRouter>
          <LogProvider>
            <ConnectionProvider>
              <InstrumentsProvider>
                <App />
              </InstrumentsProvider>
            </ConnectionProvider>
          </LogProvider>
        </BrowserRouter>
      </ThemeModeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
