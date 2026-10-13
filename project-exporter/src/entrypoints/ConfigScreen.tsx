import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Section, SelectField, TextField } from 'datocms-react-ui';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import downloadAllAssets from '../utils/downloadAllAssets';
import downloadAllRecords from '../utils/downloadAllRecords';
import { exportProjectDump } from '../utils/projectDump';
import LoadingOverlay from './LoadingOverlay';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type Option = {
  label: string;
  value: string;
};

export type AvailableFormats = 'JSON' | 'CSV' | 'XML' | 'XLSX';

const FORMATS: AvailableFormats[] = ['JSON', 'CSV', 'XML', 'XLSX'];

const CLI_README_URL = 'https://github.com/datocms/cli#readme';

const ASSET_OPTIONS = [
  {
    includeAssets: false,
    label: 'Without asset files',
    hint: "Asset metadata and URLs only, so a deleted asset can't be brought back",
  },
  {
    includeAssets: true,
    label: 'With asset files',
    hint: "Every asset's file too, so the dump can bring back deleted assets",
  },
];

type ExportRequest =
  | { kind: 'dump' }
  | { kind: 'records'; modelIDs?: string[]; textQuery?: string }
  | { kind: 'assets' };

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
  const [includeAssets, setIncludeAssets] = useState(false);
  const [isOtherFormatsOpen, setOtherFormatsOpen] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Option[]>([]);
  const [allModels, setAllModels] = useState<Option[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<AvailableFormats>(
    (ctx.plugin.attributes.parameters.format as AvailableFormats) ?? 'JSON',
  );
  const [textQuery, setTextQuery] = useState('');
  const activeExport = useRef<AbortController | null>(null);

  useEffect(() => () => activeExport.current?.abort(), []);

  useEffect(() => {
    const accessToken = ctx.currentUserAccessToken;
    if (!accessToken || !isOtherFormatsOpen) {
      return;
    }

    const controller = new AbortController();
    const client = buildClient({
      apiToken: accessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });

    client.itemTypes
      .list()
      .then((models) => {
        if (controller.signal.aborted) return;
        setAllModels(
          models
            .filter((model) => !model.modular_block)
            .map((model) => ({ label: model.name, value: model.id })),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          ctx.alert('Could not load models. Reload the plugin to try again.');
      });
    return () => controller.abort();
  }, [
    ctx.currentUserAccessToken,
    ctx.environment,
    ctx.cmaBaseUrl,
    ctx.alert,
    isOtherFormatsOpen,
  ]);

  const startExport = async (
    request: ExportRequest,
    apiToken: string,
    onProgress: (progress: number, message: string) => void,
    signal: AbortSignal,
  ): Promise<void> => {
    if (request.kind === 'dump') {
      await exportProjectDump({
        apiToken,
        environment: ctx.environment,
        primary: ctx.isEnvironmentPrimary,
        baseUrl: ctx.cmaBaseUrl,
        includeAssets,
        onProgress,
        signal,
      });
    } else if (request.kind === 'records') {
      await downloadAllRecords(
        apiToken,
        ctx.environment,
        ctx.cmaBaseUrl,
        selectedFormat,
        { modelIDs: request.modelIDs, textQuery: request.textQuery },
        onProgress,
        signal,
      );
    } else {
      await downloadAllAssets(
        apiToken,
        ctx.environment,
        ctx.cmaBaseUrl,
        onProgress,
        signal,
      );
    }
  };

  const runExport = async (request: ExportRequest) => {
    if (activeExport.current) return;
    const apiToken = ctx.currentUserAccessToken;
    if (!apiToken) {
      await ctx.alert(
        'A user access token is required to export this project.',
      );
      return;
    }
    const controller = new AbortController();
    activeExport.current = controller;
    setLoading(true);
    setLoadingStatus('Starting the export...');
    setLoadingProgress(0);
    let completion = '';
    let failure: string | undefined;
    const onProgress = (progress: number, msg: string) => {
      if (!controller.signal.aborted) {
        setLoadingStatus(msg);
        setLoadingProgress(progress);
        if (progress === 100) completion = msg;
      }
    };
    try {
      await startExport(request, apiToken, onProgress, controller.signal);
    } catch (error) {
      if (controller.signal.aborted)
        completion = 'Export cancelled. Nothing was downloaded.';
      else failure = exportErrorMessage(error);
    } finally {
      activeExport.current = null;
      setLoading(false);
      setLoadingStatus('');
      setLoadingProgress(undefined);
    }
    // The overlay closes as the download starts; the toast follows it.
    if (completion) await ctx.notice(completion);
    if (failure) await ctx.alert(failure);
  };

  const changeFormat = (format: AvailableFormats) => {
    setSelectedFormat(format);
    ctx
      .updatePluginParameters({ format })
      .then(() => ctx.notice('Format successfully updated!'));
  };

  return (
    <Canvas ctx={ctx}>
      {isLoading && (
        <LoadingOverlay
          status={loadingStatus}
          progress={loadingProgress}
          onCancel={() => {
            activeExport.current?.abort();
            setLoadingStatus('Cancelling export...');
          }}
        />
      )}
      <div className={`${s.screen} dl-kit-form-parity`}>
        <div className={s.stack}>
          <p className={s.intro}>
            Export the <code className={s.code}>{ctx.environment}</code>{' '}
            environment as a project dump: one zip with every record, asset and
            asset folder, which the DatoCMS CLI can compare with any environment
            and restore from.
          </p>
          <fieldset className={s.options} aria-label="Asset files">
            {ASSET_OPTIONS.map((option) => (
              <label
                key={option.label}
                className={`${s.option} ${includeAssets === option.includeAssets ? s.optionChecked : ''}`}
              >
                <span className={s.optionRadio}>
                  <input
                    type="radio"
                    name="includeAssets"
                    checked={includeAssets === option.includeAssets}
                    onChange={() => setIncludeAssets(option.includeAssets)}
                  />
                </span>
                <span className={s.optionBody}>
                  <span className={s.optionLabel}>{option.label}</span>
                  <span className={s.optionHint}>{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className={s.action}>
            <Button
              buttonType="primary"
              buttonSize="l"
              fullWidth
              disabled={isLoading}
              onClick={() => runExport({ kind: 'dump' })}
            >
              Export project dump
            </Button>
            <p className={s.hint}>
              To compare or restore content with it, see the{' '}
              <a
                className={s.link}
                href={CLI_README_URL}
                target="_blank"
                rel="noreferrer"
              >
                DatoCMS CLI readme
              </a>
            </p>
          </div>
        </div>

        <Section
          title="Other export formats"
          titleClassName="dl-section-parity"
          headerStyle={{ marginBottom: 'var(--spacing-m)' }}
          collapsible={{
            isOpen: isOtherFormatsOpen,
            onToggle: () => setOtherFormatsOpen((isOpen) => !isOpen),
          }}
        >
          <div className={s.stack}>
            <p className={s.note}>
              For reading your content in other tools. The DatoCMS CLI cannot
              import these files: to restore or compare content, export a
              project dump.
            </p>
            <SelectField
              id="format"
              name="format"
              label="Record format"
              hint="Also used by Download this record in the record sidebar"
              value={{ label: selectedFormat, value: selectedFormat }}
              selectInputProps={{
                isMulti: false,
                options: FORMATS.map((format) => ({
                  label: format,
                  value: format,
                })),
              }}
              onChange={(option) => {
                if (option) changeFormat(option.value as AvailableFormats);
              }}
            />
            <div className={s.buttonRow}>
              <Button
                fullWidth
                disabled={isLoading}
                onClick={() => runExport({ kind: 'records' })}
              >
                Download all records
              </Button>
              <Button
                fullWidth
                disabled={isLoading}
                onClick={() => runExport({ kind: 'assets' })}
              >
                Download all assets
              </Button>
            </div>
            <div className={s.action}>
              <SelectField
                id="models"
                name="models"
                label="Records of some models"
                placeholder="Select models"
                value={selectedModels}
                selectInputProps={{ isMulti: true, options: allModels }}
                onChange={(options) => setSelectedModels([...options])}
              />
              <Button
                fullWidth
                disabled={isLoading || !selectedModels.length}
                onClick={() =>
                  runExport({
                    kind: 'records',
                    modelIDs: selectedModels.map((model) => model.value),
                  })
                }
              >
                Download records of the selected models
              </Button>
            </div>
            <div className={s.action}>
              <TextField
                id="textQuery"
                name="textQuery"
                label="Records matching a text search"
                value={textQuery}
                onChange={setTextQuery}
              />
              <Button
                fullWidth
                disabled={isLoading || !textQuery}
                onClick={() => runExport({ kind: 'records', textQuery })}
              >
                Download matching records
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </Canvas>
  );
}
