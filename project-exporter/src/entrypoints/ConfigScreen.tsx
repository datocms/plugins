import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import SettingsList from 'datocms-react-ui/SettingsList';
import StringInput from 'datocms-react-ui/StringInput';
import { useEffect, useRef, useState } from 'react';
import downloadAllAssets from '../utils/downloadAllAssets';
import downloadAllRecords from '../utils/downloadAllRecords';
import { exportProjectDump } from '../utils/projectDump';
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
    value: 'without',
    label: 'Without asset files',
    hint: "Asset metadata and URLs only, so a deleted asset can't be brought back.",
  },
  {
    value: 'with',
    label: 'With asset files',
    hint: "Every asset's file too, so the dump can bring back deleted assets.",
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

type ExportProgressProps = {
  status: string;
  progress?: number;
  onCancel: () => void;
};

function ExportProgress({ status, progress, onCancel }: ExportProgressProps) {
  return (
    <Page.Group
      title="Export in progress"
      footer={
        <Button expand={false} label="Cancel export" onClick={onCancel} />
      }
    >
      <div className={s.readout}>
        <ProgressBar value={(progress ?? 0) / 100} ariaLabel="Export" />
        <p className={s.line}>
          <span>{status}</span>
          <span className={s.meta}>{Math.round(progress ?? 0)}%</span>
        </p>
        <p className={s.meta}>Keep this page open until the download starts.</p>
      </div>
    </Page.Group>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  const [isLoading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState<number | undefined>(
    undefined,
  );
  const [includeAssets, setIncludeAssets] = useState(false);
  const [isOtherFormatsOpen, setOtherFormatsOpen] = useState(false);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
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
          ctx.alert("The models didn't load. Reload the page to try again.");
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
    // The progress view closes as the download starts; the toast follows it.
    if (completion) await ctx.notice(completion);
    if (failure) await ctx.alert(failure);
  };

  const changeFormat = (format: AvailableFormats) => {
    setSelectedFormat(format);
    ctx
      .updatePluginParameters({ format })
      .then(() => ctx.notice('Record format saved.'));
  };

  return (
    <Canvas ctx={ctx}>
      <Page className={s.page}>
        <Page.Content>
          {isLoading ? (
            <ExportProgress
              status={loadingStatus}
              progress={loadingProgress}
              onCancel={() => {
                activeExport.current?.abort();
                setLoadingStatus('Cancelling export...');
              }}
            />
          ) : (
            <>
              <Page.Section>
                <Page.SectionTitle>Project dump</Page.SectionTitle>
                <Page.SectionDescription>
                  One zip with every record, asset and asset folder of the{' '}
                  <code>{ctx.environment}</code> environment, which the DatoCMS
                  CLI can compare with any environment and restore from. See the{' '}
                  <a href={CLI_README_URL} target="_blank" rel="noreferrer">
                    DatoCMS CLI readme
                  </a>
                  .
                </Page.SectionDescription>
                <FieldWrapper label="Asset files">
                  <RadioGroupInput
                    value={includeAssets ? 'with' : 'without'}
                    onChange={(value) => setIncludeAssets(value === 'with')}
                    options={ASSET_OPTIONS}
                  />
                </FieldWrapper>
                <div>
                  <Button
                    tone="primary"
                    expand={false}
                    label="Export project dump"
                    onClick={() => runExport({ kind: 'dump' })}
                  />
                </div>
              </Page.Section>

              <Page.Group
                title="Other export formats"
                collapse={{
                  open: isOtherFormatsOpen,
                  onToggle: () => setOtherFormatsOpen((open) => !open),
                }}
                footer="For reading your content in other tools. The DatoCMS CLI can't import these files: to restore or compare content, export a project dump."
              >
                <FieldWrapper
                  label="Record format"
                  hint="Also used by “Download this record” in the record sidebar."
                >
                  <RadioGroupInput
                    small
                    value={selectedFormat}
                    onChange={(value) => {
                      if (value) changeFormat(value);
                    }}
                    options={FORMATS.map((format) => ({
                      value: format,
                      label: format,
                    }))}
                  />
                </FieldWrapper>
                <SettingsList className={s.block}>
                  <SettingsList.Row
                    title="All records"
                    description="One file with every record, in the record format."
                    action={
                      <Button
                        tone="ghost"
                        label="Download records"
                        onClick={() => runExport({ kind: 'records' })}
                      />
                    }
                  />
                  <SettingsList.Row
                    title="All assets"
                    description="One zip with every asset file."
                    action={
                      <Button
                        tone="ghost"
                        label="Download assets"
                        onClick={() => runExport({ kind: 'assets' })}
                      />
                    }
                  />
                </SettingsList>
                <FieldWrapper label="Records of some models">
                  <SelectInput
                    multiple
                    value={selectedModelIds}
                    onChange={(ids) => setSelectedModelIds(ids ?? [])}
                    options={allModels}
                    placeholder="Pick one or more models"
                  />
                </FieldWrapper>
                <div className={s.block}>
                  <Button
                    label="Download records of the selected models"
                    disabled={
                      selectedModelIds.length === 0
                        ? { reason: 'Pick at least one model.' }
                        : undefined
                    }
                    onClick={() =>
                      runExport({ kind: 'records', modelIDs: selectedModelIds })
                    }
                  />
                </div>
                <FieldWrapper label="Records matching a text search">
                  <StringInput
                    value={textQuery}
                    onChange={(value) => setTextQuery(value ?? '')}
                    placeholder="Summer sale"
                  />
                </FieldWrapper>
                <div className={s.block}>
                  <Button
                    label="Download matching records"
                    disabled={
                      textQuery
                        ? undefined
                        : { reason: 'Type the text to search for.' }
                    }
                    onClick={() => runExport({ kind: 'records', textQuery })}
                  />
                </div>
              </Page.Group>
            </>
          )}
        </Page.Content>
      </Page>
    </Canvas>
  );
}
