import BlankSlate, {
  type BlankSlateDocsLink,
} from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import { GlobeIcon } from '../../icons';
import { pluginSettingsUrl, SETUP_GUIDE_URL } from '../../utils/urls';

const DOCS: BlankSlateDocsLink[] = [
  { label: 'Setup guide', href: SETUP_GUIDE_URL },
];

type Props = {
  /**
   * `area` fills a positioned parent that has a height (the preview
   * sidebar). `inline` is the only content of a frame that sizes itself (the
   * record sidebar panel).
   */
  placement: 'area' | 'inline';
  /** The small size, for a narrow frame */
  small?: boolean;
};

/**
 * What the record sidebar panel and the preview sidebar show while no
 * frontend returns preview links: where to read how to set one up and, for
 * the roles that can change it, the way to the plugin settings.
 */
export function PreviewSetupGuide({ placement, small }: Props) {
  const ctx = useCtx();
  const canEditSchema = ctx.currentRole.meta.final_permissions.can_edit_schema;

  return (
    <BlankSlate
      placement={placement}
      small={small}
      icon={<GlobeIcon />}
      title="No website to preview"
      description="Web Previews is installed, but no frontend returns preview links yet. A developer can add one in the plugin settings."
      docs={DOCS}
      actions={
        canEditSchema ? (
          <Button
            tone="primary"
            label="Open plugin settings"
            to={pluginSettingsUrl(ctx)}
          />
        ) : undefined
      }
    />
  );
}
