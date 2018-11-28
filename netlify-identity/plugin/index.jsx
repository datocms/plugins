import React from 'react';
import { render } from 'react-dom';

import Main from './Main';

// window.DatoCmsPlugin.init((plugin) => {
//   plugin.startAutoResizer();

//   const container = document.createElement('div');
//   document.body.appendChild(container);

//   render(<Main plugin={plugin} />, container);
// });

const plugin = {
  addFieldChangeListener() {},
  getFieldValue() {
    return '5c6853f2-726e-426a-9b69-8e479f75b17f';
  },
  parameters: {
    global: {
      endpointUrl: 'https://www.coedu.it/.netlify/functions/user-info',
      accessToken: 'XXX',
    },
  },
};

const container = document.createElement('div');
document.body.appendChild(container);

render(<Main plugin={plugin} />, container);
