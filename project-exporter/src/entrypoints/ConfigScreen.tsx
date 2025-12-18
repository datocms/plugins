import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  CaretDownIcon,
  CaretUpIcon,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  SelectField,
  TextField,
} from 'datocms-react-ui';
import s from './styles.module.css';
import { useEffect, useState } from 'react';
import downloadAllRecords from '../utils/downloadAllRecords';
import downloadAllAssets from '../utils/downloadAllAssets';
import { buildClient } from '@datocms/cma-client-browser';
import LoadingOverlay from './LoadingOverlay';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type ModelObject = {
  name: string;
  id: string;
};

export type AvailableFormats = 'JSON' | 'CSV' | 'XML' | 'XLSX';

export default function ConfigScreen({ ctx }: Props) {
  const [isLoading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState<number | undefined>(
    undefined
  );
  const [selectedModels, setSelectedModels] = useState<ModelObject[]>([]);
  const [allModels, setAllModels] = useState<ModelObject[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<AvailableFormats>(
    (ctx.plugin.attributes.parameters.format as AvailableFormats) ?? 'JSON'
  );
  const [textQuery, setTextQuery] = useState('');

  useEffect(() => {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken!,
    });

    client.itemTypes.list().then((models) => {
      setAllModels(
        models
          .filter((model) => !model.modular_block)
          .map((model) => {
            return { name: model.name, id: model.id };
          })
      );
    });
  }, [ctx.currentUserAccessToken]);

  const handleRecordDownload = async (
    options: { modelIDs?: string[]; textQuery?: string } = {}
  ) => {
    setLoading(true);
    setLoadingStatus('Initializing download...');
    setLoadingProgress(0);

    await downloadAllRecords(
      ctx.currentUserAccessToken!,
      selectedFormat,
      options,
      (progress, msg) => {
        setLoadingStatus(msg);
        setLoadingProgress(progress);
      }
    );

    setLoading(false);
    setLoadingStatus('');
    setLoadingProgress(undefined);
  };

  const handleAllAssets = async () => {
    setLoading(true);
    setLoadingStatus('Initializing asset download...');
    setLoadingProgress(undefined);

    await downloadAllAssets(
      ctx.currentUserAccessToken as string,
      (msg) => setLoadingStatus(msg)
    );

    setLoading(false);
    setLoadingStatus('');
    setLoadingProgress(undefined);
  };

  return (
    <Canvas ctx={ctx}>
      {isLoading && (
        <LoadingOverlay status={loadingStatus} progress={loadingProgress} />
      )}
      <div className={s.buttonList}>
        <div
          style={{
            display: 'flex',
            gap: '20px',
            alignItems: 'center',
            marginBottom: '20px',
            textAlign: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: '16px' }}>Format for exports</span>
          <Dropdown
            renderTrigger={({ open, onClick }) => (
              <Button
                onClick={onClick}
                rightIcon={open ? <CaretUpIcon /> : <CaretDownIcon />}
              >
                {selectedFormat}
              </Button>
            )}
          >
            <DropdownMenu>
              <DropdownOption
                onClick={() => {
                  setSelectedFormat('JSON');
                  ctx
                    .updatePluginParameters({
                      format: 'JSON',
                    })
                    .then(() => {
                      ctx.notice('Format for exports updated');
                    });
                }}
              >
                JSON
              </DropdownOption>
              <DropdownOption
                onClick={() => {
                  setSelectedFormat('CSV');
                  ctx
                    .updatePluginParameters({
                      format: 'CSV',
                    })
                    .then(() => {
                      ctx.notice('Format for exports updated');
                    });
                }}
              >
                CSV
              </DropdownOption>
              <DropdownOption
                onClick={() => {
                  setSelectedFormat('XML');
                  ctx
                    .updatePluginParameters({
                      format: 'XML',
                    })
                    .then(() => {
                      ctx.notice('Format for exports updated');
                    });
                }}
              >
                XML
              </DropdownOption>
              <DropdownOption
                onClick={() => {
                  setSelectedFormat('XLSX');
                  ctx
                    .updatePluginParameters({
                      format: 'XLSX',
                    })
                    .then(() => {
                      ctx.notice('Format for exports updated');
                    });
                }}
              >
                XLSX
              </DropdownOption>
            </DropdownMenu>
          </Dropdown>
        </div>
        <div className={s.tooltipBox} style={{ textAlign: 'center' }}>
          You can download a specific record from its own sidebar
        </div>
        <div
          style={{
            width: '100%',
            height: '1px',
            backgroundColor: '#e0e0e0',
            margin: '20px 0',
          }}
        />

        <div className={s.modelSelectorContainer}>
          <div className={s.modelSelector}>
            <SelectField
              name="multipleOption"
              id="multipleOption"
              label=""
              placeholder="Select models to download records from"
              value={selectedModels.map((model) => {
                return { label: model.name, value: model.id };
              })}
              selectInputProps={{
                isMulti: true,
                options: allModels.map((model) => {
                  return { label: model.name, value: model.id };
                }),
              }}
              onChange={(newValue) =>
                setSelectedModels(
                  newValue.map((model) => {
                    return { name: model.label, id: model.value };
                  })
                )
              }
            />
          </div>

          <Button
            disabled={!selectedModels.length}
            onClick={() =>
              handleRecordDownload({
                modelIDs: selectedModels.map((model) => model.id),
              })
            }
            fullWidth
          >
            Download records from selected models
          </Button>
        </div>

        <div className={s.textQueryContainer}>
          <TextField
            name="name"
            id="name"
            label=""
            value={textQuery}
            onChange={(newValue) => setTextQuery(newValue)}
          />
          <Button
            disabled={!textQuery}
            onClick={() => handleRecordDownload({ textQuery })}
            fullWidth
          >
            Download records from text query
          </Button>
        </div>
        <Button
          className={s.buttonItem}
          onClick={() => handleRecordDownload()}
          disabled={isLoading}
        >
          Download all records
        </Button>
        <Button
          onClick={handleAllAssets}
          className={s.buttonItem + ' ' + s.assetItem}
          disabled={isLoading}
        >
          Download all assets
        </Button>
        <div className={s.tooltipBox}>
          <span className={s.tooltipSpan}>
            Keep in mind that for projects with too many records this button
            will not work, instead, use the script specified here:{' '}
            <a
              href="https://www.datocms.com/docs/import-and-export/export-data"
              target="_blank"
              rel="noreferrer"
              style={{
                color: '#0077cc',
                textDecoration: 'none',
              }}
            >
              https://www.datocms.com/docs/import-and-export/export-data
            </a>
          </span>
        </div>
      </div>
    </Canvas>
  );
}
