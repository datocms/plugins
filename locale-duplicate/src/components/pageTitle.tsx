import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';

/**
 * The title of every phase of the duplication page. It is an element, not a
 * component: the parts of Pane.Header must be its direct children.
 */
export const pageTitle = (
  <Pane.Header.Title
    level={1}
    help={
      <Toolbar.Help>
        Copies the content of one locale into another, in every record of the
        models you pick. Use it to set up a new locale or a starting point for
        translations.
      </Toolbar.Help>
    }
  >
    Mass locale duplication
  </Pane.Header.Title>
);
