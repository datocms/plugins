import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
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
import { useEffect, useRef, useState } from 'react';
import downloadAllAssets from '../utils/downloadAllAssets';
import downloadAllRecords from '../utils/downloadAllRecords';
import { createExportClient } from '../utils/exportRuntime';
import LoadingOverlay from './LoadingOverlay';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type ModelObject = {
  name: string;
  id: string;
};

export type AvailableFormats = 'JSON' | 'CSV' | 'XML' | 'XLSX';

function exportErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The export failed. Please try again.';
}

export default function ConfigScreen({ ctx }: Props) {
  const [isLoading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState<number | undefined>(
    undefined,
  );
  const [isFilteredExportOpen, setIsFilteredExportOpen] = useState(false);
  const [selectedModels, setSelectedModels] = useState<ModelObject[]>([]);
  const [allModels, setAllModels] = useState<ModelObject[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<AvailableFormats>(
    (ctx.plugin.attributes.parameters.format as AvailableFormats) ?? 'JSON',
  );
  const [textQuery, setTextQuery] = useState('');
  const activeExport = useRef<AbortController | null>(null);
  const [isLargeExport, setLargeExport] = useState(false);

  useEffect(() => () => activeExport.current?.abort(), []);

  useEffect(() => {
    const accessToken = ctx.currentUserAccessToken;
    if (!accessToken) {
      return;
    }

    const controller = new AbortController();
    const client = createExportClient(
      {
        apiToken: accessToken,
        environment: ctx.environment,
        baseUrl: ctx.cmaBaseUrl,
      },
      controller.signal,
    );

    client.itemTypes
      .list()
      .then((models) => {
        if (controller.signal.aborted) return;
        setAllModels(
          models
            .filter((model) => !model.modular_block)
            .map((model) => {
              return { name: model.name, id: model.id };
            }),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          ctx.alert('Could not load models. Reload the plugin to try again.');
      });
    return () => controller.abort();
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl, ctx.alert]);

  const runExport = async (
    kind: 'records' | 'assets',
    options: { modelIDs?: string[]; textQuery?: string } = {},
  ) => {
    if (activeExport.current) return;
    if (!ctx.currentUserAccessToken) {
      await ctx.alert(
        'A user access token is required to export this project.',
      );
      return;
    }
    const controller = new AbortController();
    activeExport.current = controller;
    setLoading(true);
    setLoadingStatus('Initializing download...');
    setLoadingProgress(0);
    setLargeExport(false);
    let completion = '';
    const onProgress = (progress: number, msg: string) => {
      if (!controller.signal.aborted) {
        setLoadingStatus(msg);
        setLoadingProgress(progress);
        if (
          msg.includes(' for part ') ||
          msg.match(/\d+/g)?.some((count) => Number(count) >= 1000)
        )
          setLargeExport(true);
        if (progress === 100) completion = msg;
      }
    };
    try {
      if (kind === 'records') {
        await downloadAllRecords(
          ctx.currentUserAccessToken,
          ctx.environment,
          ctx.cmaBaseUrl,
          selectedFormat,
          options,
          onProgress,
          controller.signal,
        );
      } else {
        await downloadAllAssets(
          ctx.currentUserAccessToken,
          ctx.environment,
          ctx.cmaBaseUrl,
          onProgress,
          controller.signal,
        );
      }
      if (completion) await ctx.notice(completion);
    } catch (error) {
      if (controller.signal.aborted) {
        await ctx.notice(
          'Export cancelled. Files already prepared remain in your downloads.',
        );
      } else {
        await ctx.alert(exportErrorMessage(error));
      }
    } finally {
      activeExport.current = null;
      setLoading(false);
      setLoadingStatus('');
      setLoadingProgress(undefined);
    }
  };

  const handleRecordDownload = (
    options: { modelIDs?: string[]; textQuery?: string } = {},
  ) => runExport('records', options);
  const handleAllAssets = () => runExport('assets');

  return (
    <Canvas ctx={ctx}>
      {isLoading && (
        <LoadingOverlay
          status={loadingStatus}
          progress={loadingProgress}
          onCancel={
            isLargeExport
              ? () => {
                  activeExport.current?.abort();
                  setLoadingStatus('Cancelling export...');
                }
              : undefined
          }
        />
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
            backgroundColor: 'var(--color--border)',
            margin: '20px 0',
          }}
        />

        <Button
          className={s.buttonItem}
          onClick={() => handleRecordDownload()}
          disabled={isLoading}
        >
          Download all records
        </Button>
        <Button
          onClick={handleAllAssets}
          className={s.buttonItem}
          disabled={isLoading}
        >
          Download all assets
        </Button>
        <Button
          className={s.buttonItem}
          onClick={() => setIsFilteredExportOpen((isOpen) => !isOpen)}
          rightIcon={isFilteredExportOpen ? <CaretUpIcon /> : <CaretDownIcon />}
        >
          Filtered export
        </Button>
        {isFilteredExportOpen && (
          <div className={s.filteredExportOptions}>
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
                      }),
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
          </div>
        )}
      </div>
    </Canvas>
  );
}
