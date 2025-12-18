import { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import downloadRecordsFile from '../utils/downloadRecordsFile';
import { AvailableFormats } from './ConfigScreen';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

export default function RecordDownloaderSidebar({ ctx }: PropTypes) {
  const downloadTxtFile = async () => {
    if (!ctx.item) {
      ctx.alert('Save the record before trying to download it!');
      return;
    }

    const recordValue = ctx.item;

    downloadRecordsFile(
      [recordValue],
      ctx.plugin.attributes.parameters.format as AvailableFormats | 'JSON'
    );
  };

  return (
    <Canvas ctx={ctx}>
      <Button onClick={downloadTxtFile}>Download this record</Button>
    </Canvas>
  );
}
