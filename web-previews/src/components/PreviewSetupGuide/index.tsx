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
 * frontend returns preview links. The roles that can change the settings get
 * the way to them and the guide; the others, whom to ask.
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
      description={
        canEditSchema
          ? 'A developer can connect one in the plugin settings.'
          : 'Ask a developer or an administrator to connect one.'
      }
      docs={canEditSchema ? DOCS : undefined}
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
