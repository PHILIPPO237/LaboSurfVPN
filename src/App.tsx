import React, { useEffect } from 'react';
import { useApp } from './context/AppContext';
import { SvgSprite } from './components/SvgIcons';
import { SplashScreen } from './components/SplashScreen';
import { NavigationRail } from './components/NavigationRail';
import { ExpiryBanner } from './components/ExpiryBanner';
import { ToastContainer } from './components/ToastContainer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { GuideModal } from './components/GuideModal';
import { OnboardingModal } from './components/OnboardingModal';

import { HomeScreen } from './screens/HomeScreen';
import { ServicesScreen } from './screens/ServicesScreen';
import { ServersScreen } from './screens/ServersScreen';
import { AccountScreen } from './screens/AccountScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { LogsScreen } from './screens/LogsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AboutScreen } from './screens/AboutScreen';
import { CommunityScreen } from './screens/CommunityScreen';
import { LegalScreen } from './screens/LegalScreen';
import { ClientsScreen } from './screens/ClientsScreen';

export const App: React.FC = () => {
  const { currentScreen, openOnboarding } = useApp();

  useEffect(() => {
    // Check if first time launch to show onboarding walkthrough
    try {
      const onboarded = localStorage.getItem('ls.onboarded');
      if (!onboarded) {
        // give brief delay after splash
        const t = setTimeout(() => openOnboarding(), 4800);
        return () => clearTimeout(t);
      }
    } catch (e) {
      // ignore
    }
  }, [openOnboarding]);

  return (
    <>
      <SvgSprite />
      <SplashScreen />

      <div className="app" id="app">
        <main className="screens">
          <NavigationRail />

          {currentScreen === 'home' && <HomeScreen />}
          {currentScreen === 'services' && <ServicesScreen />}
          {currentScreen === 'servers' && <ServersScreen />}
          {currentScreen === 'account' && <AccountScreen />}
          {currentScreen === 'activity' && <ActivityScreen />}
          {currentScreen === 'logs' && <LogsScreen />}
          {currentScreen === 'settings' && <SettingsScreen />}
          {currentScreen === 'about' && <AboutScreen />}
          {currentScreen === 'community' && <CommunityScreen />}
          {currentScreen === 'legal' && <LegalScreen />}
          {currentScreen === 'clients' && <ClientsScreen />}
        </main>

        <ExpiryBanner />
      </div>

      <GuideModal />
      <OnboardingModal />
      <ToastContainer />
      <ConfirmDialog />
    </>
  );
};
