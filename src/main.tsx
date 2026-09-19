import { StrictMode, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";
import { useAppStore } from "./store";
import { subscribeTheme } from "./theme";

function Bootstrap() {
  const initialize = useAppStore((state) => state.initialize);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  return <App />;
}

// Establish the subscription once at startup so system-theme changes also update
// the React tree's consumers without requiring a page reload.
function ThemeBootstrap() {
  useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme);
  return <Bootstrap />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeBootstrap />
    </BrowserRouter>
  </StrictMode>,
);
