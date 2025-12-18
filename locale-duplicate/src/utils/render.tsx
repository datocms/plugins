/**
 * Render utility for mounting React components in the DatoCMS plugin environment.
 * Uses React 18's createRoot API with StrictMode for better development experience.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Create root once to avoid multiple root instances
const container = document.getElementById("root");
const root = createRoot(container!);

/**
 * Renders a React component into the plugin's root container.
 * Note: Error boundaries should be added at the component level to have access to ctx
 * 
 * @param component - The React component to render
 */
export function render(component: React.ReactNode): void {
	root.render(<StrictMode>{component}</StrictMode>);
}
