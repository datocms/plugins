import 'regenerator-runtime/runtime';
import React from 'react';
import { render } from 'react-dom';
import Root from './Root';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  const container = document.createElement('div');
  document.body.appendChild(container);

  render(<Root plugin={plugin} />, container);
});
