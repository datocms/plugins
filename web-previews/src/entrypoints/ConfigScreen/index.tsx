import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { Page } from 'datocms-react-ui/Page';
import { useFrameSizedToContent } from '../../utils/frame';
import { DisplaySection } from './DisplaySection';
import { FrontendsSection } from './FrontendsSection';
import { IframeSection } from './IframeSection';
import s from './styles.module.css';
import { useSettingsForm } from './useSettingsForm';
import { ViewportsSection } from './ViewportsSection';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: PropTypes) {
  useFrameSizedToContent();
  const form = useSettingsForm(ctx);

  return (
    <Page variant="large" className={s.page}>
      <Page.Content>
        {/* One form spans every section, so Save follows the last one */}
        <form onSubmit={form.handleSubmit}>
          <FrontendsSection form={form} />
          <DisplaySection form={form} />
          <ViewportsSection form={form} />
          <IframeSection form={form} />
          {form.saveFailed && (
            <Callout tone="danger" title="Some settings aren't valid">
              Fix the fields that show an error, then save.
            </Callout>
          )}
          <Button
            submit
            tone="primary"
            expand
            label="Save"
            busy={form.saving}
            disabled={
              form.dirty ? undefined : { reason: 'Change a setting to save.' }
            }
          />
        </form>
      </Page.Content>
    </Page>
  );
}
