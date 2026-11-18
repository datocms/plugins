import { LucideProvider } from 'lucide-react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root') || document.body;
const root = createRoot(container);

// Lucide draws its icons at 24px; the kit's icons are 1em, the size of the
// text around them. The provider's type takes only a number, but the size goes
// straight to the width and height of the svg.
const ICON_SIZE = '1em' as unknown as number;

export const render = (component: React.ReactNode) => {
  root.render(<LucideProvider size={ICON_SIZE}>{component}</LucideProvider>);
};
