import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom';

export function render(component: React.ReactNode): void {
  ReactDOM.render(<StrictMode>{component}</StrictMode>, document.getElementById('root'));
}
