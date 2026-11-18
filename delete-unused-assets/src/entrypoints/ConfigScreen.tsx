import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import Link from 'datocms-react-ui/Link';
import { unusedAssetsPagePath } from '../utils/paths';
import s from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

/**
 * The plugin has no settings: the screen points to the page of the tool, in
 * the settings of the project.
 */
export default function ConfigScreen({ ctx }: Props) {
  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the note starts the frame
  return (
    <Canvas ctx={ctx}>
      <p className={s.note}>
        This plugin has no settings. To find and delete the assets that no
        record uses, open{' '}
        <Link to={unusedAssetsPagePath(ctx)}>Unused assets</Link> in the project
        settings.
      </p>
    </Canvas>
  );
}
