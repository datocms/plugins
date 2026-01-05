import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
const root = createRoot(container!);

/**
 * Render a React node into the plugin root with React StrictMode enabled.
 * Keeps rendering concerns separated from plugin wiring code.
 *
 * @param component - React node to render
 * @returns void
 * @example
 * ```tsx
 * render(<MyComponent />);
 * ```
 */
export function render(component: React.ReactNode): void {
	root.render(<StrictMode>{component}</StrictMode>);
}
