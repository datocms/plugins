/**
 * LoadingAddon.tsx
 * Legacy placeholder field extension ('loadingAddon') that shows a loading
 * state. It renders inside the Canvas that main.tsx puts around the hook.
 *
 * Nothing names what loads here, so it is a spinner alone: a small
 * Spinner.Area keeps the place of a line, and a screen reader tells
 * "Loading" (a BlankSlate is for an area that tells what it loads).
 */
import Spinner from 'datocms-react-ui/Spinner';

function LoadingAddon() {
  return <Spinner.Area size="small" />;
}

export default LoadingAddon;
