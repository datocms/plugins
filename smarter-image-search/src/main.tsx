import {
  connect,
  type RenderModalCtx,
  type RenderPageCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import SearchModal from './entrypoints/SearchModal';
import SearchPage, { SEARCH_MODAL_ID } from './entrypoints/SearchPage';
import { render } from './utils/render';

const PAGE_ID = 'smarter-image-search';

connect({
  mainNavigationTabs() {
    return [
      {
        label: 'Smarter image search',
        icon: 'magnifying-glass',
        pointsTo: {
          pageId: PAGE_ID,
        },
      },
    ];
  },
  renderPage(pageId: string, ctx: RenderPageCtx) {
    if (pageId !== PAGE_ID) {
      return;
    }
    return render(<SearchPage ctx={ctx} />);
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    if (modalId !== SEARCH_MODAL_ID) {
      return;
    }
    return render(<SearchModal ctx={ctx} />);
  },
});
