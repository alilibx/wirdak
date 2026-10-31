import { api } from "@convex/_generated/api";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import { Component, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { t } from "./i18n/ar";
import { clearAdminToken, useAdminToken } from "./lib/adminSession";
import { AdminsPage } from "./pages/AdminsPage";
import { AlertSignOutPage } from "./pages/AlertSignOutPage";
import { AuditPage } from "./pages/AuditPage";
import { HelpInboxPage } from "./pages/HelpInboxPage";
import { HelpRequestPage } from "./pages/HelpRequestPage";
import { HomePage } from "./pages/HomePage";
import { KhatmaAdminPage } from "./pages/KhatmaAdminPage";
import { KhatmasPage } from "./pages/KhatmasPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PersonAdminPage } from "./pages/PersonAdminPage";
import { RotaCreatePage, RotaSetupPage } from "./pages/RotaCreatePage";
import { RotaHelpPage } from "./pages/RotaHelpPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";

/** True for the server's "this admin session is gone" error. */
export function isNotAdmin(error: unknown): boolean {
  return (
    error instanceof ConvexError &&
    (error.data as { code?: unknown } | null)?.code === "not_admin"
  );
}

/**
 * A page query that fails with `not_admin` (the session expired or the admin
 * was removed) drops the token, so the app falls back to sign-in. Any other
 * error goes on to the outer boundary.
 */
export class AdminErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    if (isNotAdmin(error)) clearAdminToken();
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (isNotAdmin(error)) return null;
    // Anything else is for the outer boundary.
    throw error;
  }
}

function SignOutButton({ adminToken }: { adminToken: string }) {
  const signOut = useMutation(api.adminAuth.signOut);
  return (
    <button
      type="button"
      className="text-[13px] font-medium underline underline-offset-4"
      onClick={() => {
        // Signed out here even if the server call fails (the session ends by itself).
        void signOut({ adminToken }).catch(() => undefined);
        clearAdminToken();
      }}
    >
      {t.signOut.button}
    </button>
  );
}

function SignedIn({
  adminToken,
  expiresAt,
}: {
  adminToken: string;
  expiresAt: number;
}) {
  // Sessions end 12 hours after sign-in; nothing on the server pushes that moment.
  useEffect(() => {
    const timer = setTimeout(
      clearAdminToken,
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return (
    <AdminErrorBoundary key={adminToken}>
      <Routes>
        <Route
          element={
            <Layout actions={<SignOutButton adminToken={adminToken} />} />
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/help" element={<HelpInboxPage />} />
          <Route path="/help/:requestId" element={<HelpRequestPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/khatmas" element={<KhatmasPage />} />
          <Route path="/khatmas/:khatmaId" element={<KhatmaAdminPage />} />
          <Route path="/khatmas/:khatmaId/rota" element={<RotaHelpPage />} />
          <Route
            path="/khatmas/:khatmaId/rota/setup"
            element={<RotaSetupPage />}
          />
          <Route
            path="/organizers"
            element={<Navigate to="/people?tab=organizers" replace />}
          />
          <Route path="/rota/new" element={<RotaCreatePage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/:personId" element={<PersonAdminPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/admins" element={<AdminsPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
    </AdminErrorBoundary>
  );
}

export function App() {
  const adminToken = useAdminToken();
  const me = useQuery(api.adminAuth.me, {
    adminToken: adminToken ?? undefined,
  });

  return (
    <Routes>
      <Route path="/signout" element={<AlertSignOutPage />} />
      <Route
        path="*"
        element={
          me === undefined ? null : me === null || adminToken === null ? (
            <SignInPage />
          ) : (
            <SignedIn adminToken={adminToken} expiresAt={me.expiresAt} />
          )
        }
      />
    </Routes>
  );
}
