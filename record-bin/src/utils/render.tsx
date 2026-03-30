import { StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

let root: Root | null = null;

export function render(component: ReactNode): void {
  const container = document.getElementById("root");

  if (!container) {
    throw new Error("Missing #root container");
  }

  if (!root) {
    root = createRoot(container);
  }

  root.render(<StrictMode>{component}</StrictMode>);
}
