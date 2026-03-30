import { createRoot } from 'react-dom/client';

const container = document.getElementById('root') || document.body;
const root = createRoot(container);

export const render = (component: React.ReactNode) => {
  root.render(component);
};
