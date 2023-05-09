import { connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import Graphviz from './entrypoints/Graphviz';
import 'datocms-react-ui/styles.css';

connect({
  settingsAreaSidebarItemGroups() {
    return [
      {
        label: 'ERD generator',
        items: [
          { label: 'Schema ERD', icon: 'project-diagram', pointsTo: { pageId: 'svg' } }
        ],
        placement: ['after', 'environment']
      }
    ]
  },
  renderPage(pageId, ctx) {
    return render(<Graphviz ctx={ctx} />);
  }
});
