import { connect } from 'datocms-plugin-sdk';
import Graphviz from './entrypoints/Graphviz';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';

connect({
  settingsAreaSidebarItemGroups() {
    return [
      {
        label: 'ERD generator',
        items: [
          {
            label: 'Schema ERD',
            icon: 'project-diagram',
            pointsTo: { pageId: 'svg' },
          },
        ],
        placement: ['after', 'properties'],
      },
    ];
  },
  renderPage(_pageId, ctx) {
    return render(<Graphviz ctx={ctx} />);
  },
});
