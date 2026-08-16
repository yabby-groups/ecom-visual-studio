import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";
import { useAppStore } from "./store";

function Bootstrap() {
  const initialize = useAppStore((state) => state.initialize);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Bootstrap />
    </BrowserRouter>
  </StrictMode>,
);
