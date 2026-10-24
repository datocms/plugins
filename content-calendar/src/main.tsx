// The kit stylesheet loads first, thus the CSS modules of the plugin come
// after it and win at the same specificity
import 'datocms-react-ui/styles.css';
import { connect } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import Page from './entrypoints/Page';
import { render } from './utils/render';

connect({
  mainNavigationTabs() {
    return [
      {
        label: 'Calendar',
        icon: 'calendar',
        pointsTo: {
          pageId: 'calendar',
        },
      },
    ];
  },
  renderPage(_pageId, ctx) {
    return render(
      <Canvas ctx={ctx}>
        <Page />
      </Canvas>,
    );
  },
});
