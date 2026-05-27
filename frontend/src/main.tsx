import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ThemeModeProvider } from './context/ThemeModeContext'
import { ConnectionProvider } from './context/ConnectionContext'
import { LogProvider } from './context/LogContext'
import { InstrumentsProvider } from './context/InstrumentsContext'
import { NicknamesProvider } from './context/NicknamesContext'
import { PathLossProvider } from './context/PathLossContext'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

// StrictMode intentionally omitted: it double-mounts every component and
// double-fires every useEffect in dev, which made hardware-heavy pages feel
// laggy on tab switches. Re-add if you need to audit effect cleanups.
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeModeProvider>
      <BrowserRouter>
        <LogProvider>
          <ConnectionProvider>
            <InstrumentsProvider>
              <NicknamesProvider>
                <PathLossProvider>
                  <App />
                </PathLossProvider>
              </NicknamesProvider>
            </InstrumentsProvider>
          </ConnectionProvider>
        </LogProvider>
      </BrowserRouter>
    </ThemeModeProvider>
  </QueryClientProvider>,
)
