import { connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import Page from './entrypoints/Page';
import 'datocms-react-ui/styles.css';

connect({
  mainNavigationTabs(ctx) {
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
  renderPage(pageId, ctx) {
    return render(<Page ctx={ctx} />);
  },
});
