import { Route, Routes, useLocation } from "react-router";
import { HandoffGate } from "./features/handoff/HandoffGate";
import { useHandoffManifest } from "./features/handoff/useHandoffManifest";
import { HelpButton } from "./features/help/HelpButton";
import { HelpProvider } from "./features/help/helpUi";
import { useClaimVisitorHelp } from "./features/help/useClaimVisitorHelp";
import { BottomBarProvider } from "./features/nav/bottomBarUi";
import { useHelpDeepLink } from "./features/help/useHelpDeepLink";
import { RotaPeopleSetup } from "./features/rota/RotaPeopleSetup";
import { OpenInBrowser } from "./features/status/OpenInBrowser";
import { StatusBanners } from "./features/status/StatusBanners";
import { BottomBar } from "./components/BottomBar";
import { RetryBoundary } from "./components/RetryBoundary";
import { AnalyticsIdentity } from "./lib/AnalyticsIdentity";
import { useTouch } from "./lib/useTouch";
import { CreatePage } from "./pages/CreatePage";
import { HomePage } from "./pages/HomePage";
import { KhatmaRoute } from "./pages/KhatmaPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrganizerPage } from "./pages/OrganizerPage";
import { RotaCreatePage } from "./pages/RotaCreatePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignOutPage } from "./pages/SignOutPage";

/** Opens a help conversation from a reply push (`/?help=<id>`). Needs the provider. */
function HelpDeepLink() {
  useHelpDeepLink();
  return null;
}

export function App() {
  useTouch();
  useHandoffManifest();
  useClaimVisitorHelp();
  // A failed query retries inside its own part of the screen; a new page starts over.
  const { pathname } = useLocation();
  return (
    <HandoffGate>
      <HelpProvider>
        <BottomBarProvider>
          <RetryBoundary resetKey={pathname} quiet>
            <StatusBanners />
          </RetryBoundary>
          <RetryBoundary resetKey={pathname} quiet>
            <AnalyticsIdentity />
          </RetryBoundary>
          <OpenInBrowser />
          <HelpButton />
          <HelpDeepLink />
          <RetryBoundary resetKey={pathname}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/new" element={<CreatePage />} />
              <Route path="/new/rota" element={<RotaCreatePage />} />
              <Route path="/j/:inviteCode" element={<KhatmaRoute />} />
              <Route
                path="/j/:inviteCode/setup"
                element={<RotaPeopleSetup />}
              />
              <Route
                path="/j/:inviteCode/settings"
                element={<OrganizerPage />}
              />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/signout" element={<SignOutPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </RetryBoundary>
          <RetryBoundary resetKey={pathname} quiet>
            <BottomBar />
          </RetryBoundary>
        </BottomBarProvider>
      </HelpProvider>
    </HandoffGate>
  );
}
