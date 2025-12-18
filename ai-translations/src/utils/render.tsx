import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
const root = createRoot(container as HTMLElement);

/**
 * Render a React node inside the plugin's root container.
 *
 * @param component - The React node to render.
 */
export function render(component: React.ReactNode): void {
	root.render(<StrictMode>{component}</StrictMode>);
}
/**
 * render.tsx
 * Centralized React render helper for the plugin entrypoints.
 * Wraps components in React.StrictMode and mounts them into the root element.
 */
