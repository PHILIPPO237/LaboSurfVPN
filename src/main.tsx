import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './context/ThemeContext';
import { AppProvider } from './context/AppContext';
import { App } from './App';

import './styles/tokens.css';
import './styles/splash.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <I18nProvider>
        <ThemeProvider>
          <AppProvider>
            <App />
          </AppProvider>
        </ThemeProvider>
      </I18nProvider>
    </React.StrictMode>
  );
}
