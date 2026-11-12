import { PostHogProvider } from "@posthog/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import posthog from "posthog-js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { linkPageManifest } from "./lib/handoff";
import { initializePostHogLogging } from "./lib/posthogLogs";
import { followSystemTheme } from "./lib/theme";
import "./styles.css";

linkPageManifest();
followSystemTheme();
initializePostHogLogging();

const root = createRoot(document.getElementById("root")!);
const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  // Developer-facing setup error, deliberately plain (not part of the Arabic UI).
  root.render(
    <pre style={{ padding: 24, whiteSpace: "pre-wrap", direction: "ltr" }}>
      Missing VITE_CONVEX_URL. Copy apps/web/.env.example to apps/web/.env.local
      and restart the dev server.
    </pre>,
  );
} else {
  const convex = new ConvexReactClient(convexUrl);
  root.render(
    <StrictMode>
      <PostHogProvider client={posthog}>
        <ErrorBoundary>
          <ConvexProvider client={convex}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConvexProvider>
        </ErrorBoundary>
      </PostHogProvider>
    </StrictMode>,
  );
}
