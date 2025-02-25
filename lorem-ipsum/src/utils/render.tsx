import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom';

/**
 * Renders the provided React component into the root element with React StrictMode.
 */
export function render(component: React.ReactNode): void {
  ReactDOM.render(
    <StrictMode>{component}</StrictMode>,
    document.getElementById('root')
  );
}