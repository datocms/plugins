import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import {
  Dropdown,
  DropdownMenu,
  DropdownOption,
  Spinner,
} from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import { ASPECT_RATIO_OPTIONS, DEFAULT_WIDTH } from '../../constants';
import { useUploadData } from '../../hooks/useUploadData';
import type { MediaLayoutItem, Upload, WidthOption } from '../../types';
import {
  formatDimensions,
  getEffectiveRatio,
  validateCustomAspectRatio,
} from '../../utils/aspectRatio';
import {
  getFormatLabel,
  isImageFormat,
  resolveFormat,
} from '../../utils/upload';
import {
  getWidthLabel,
  MAX_WIDTH,
  MIN_WIDTH,
  parseCustomWidth,
  resolveWidthValue,
  validateCustomWidth,
} from '../../utils/width';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
  item: MediaLayoutItem;
  widthOptions: WidthOption[];
  onLayoutChange: (layout: Partial<MediaLayoutItem>) => void;
  onRemove: () => void;
  onEditMetadata: () => void;
  onReplace?: () => void;
  disabled?: boolean;
  enableCssClass: boolean;
  enableLazyLoading: boolean;
};

type ResolvedCardData = {
  url: string;
  filename: string;
  format: string | null;
  originalWidth: number | null;
  originalHeight: number | null;
};

function resolveCardData(
  item: MediaLayoutItem,
  upload: Upload | null,
): ResolvedCardData {
  const url = item.url || upload?.attributes.url || '';
  const filename = item.filename || upload?.attributes.filename || '';
  const format = resolveFormat({
    format: item.format ?? upload?.attributes.format ?? null,
    url,
    filename,
  });
  const originalWidth = item.originalWidth ?? upload?.attributes.width ?? null;
  const originalHeight =
    item.originalHeight ?? upload?.attributes.height ?? null;
  return { url, filename, format, originalWidth, originalHeight };
}

function computeAspectRatioState(item: MediaLayoutItem) {
  const presetAspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (o) => o.value !== 'custom',
  );
  const aspectRatioOptions = [
    ...presetAspectRatioOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const presetAspectRatioValues = presetAspectRatioOptions.map((o) => o.value);
  const isCustomAspectRatio =
    item.aspectRatio === 'custom' ||
    !presetAspectRatioValues.includes(item.aspectRatio);
  const customAspectRatioValue =
    item.aspectRatio === 'custom'
      ? (item.customAspectRatio ?? '')
      : isCustomAspectRatio
        ? item.aspectRatio
        : '';
  const customAspectRatioError = isCustomAspectRatio
    ? validateCustomAspectRatio(customAspectRatioValue)
    : undefined;
  const aspectLabel = isCustomAspectRatio
    ? customAspectRatioValue || 'Custom'
    : ASPECT_RATIO_OPTIONS.find(
        (o) => o.value === item.aspectRatio,
      )?.label.split(' ')[0] || item.aspectRatio;
  return {
    aspectRatioOptions,
    isCustomAspectRatio,
    customAspectRatioValue,
    customAspectRatioError,
    aspectLabel,
  };
}

export default function AssetCard({
  ctx,
  item,
  widthOptions,
  onLayoutChange,
  onRemove,
  onEditMetadata,
  onReplace,
  disabled,
  enableCssClass,
  enableLazyLoading,
}: Props) {
  const baseFormat = resolveFormat({
    format: item.format,
    url: item.url,
    filename: item.filename,
  });
  const needsOriginalWidth =
    item.width === 'original' || item.aspectRatio === 'original';
  const needsOriginalHeight = item.aspectRatio === 'original';
  const needsFetch =
    !item.url ||
    !item.filename ||
    !baseFormat ||
    (needsOriginalWidth && !item.originalWidth) ||
    (needsOriginalHeight && !item.originalHeight);

  const { upload, loading, error } = useUploadData(
    ctx,
    item.uploadId,
    !needsFetch,
  );

  // All hooks must be called before any conditional returns
  const presetWidthValues = useMemo(
    () => new Set(widthOptions.map((opt) => opt.value)),
    [widthOptions],
  );
  const widthOptionsWithCustom = useMemo(
    () => [...widthOptions, { value: 'custom', label: 'Custom...' }],
    [widthOptions],
  );

  const isCustomWidthValue =
    typeof item.width === 'number' && !presetWidthValues.has(item.width);
  const [customWidthActive, setCustomWidthActive] =
    useState(isCustomWidthValue);
  const [customWidthInput, setCustomWidthInput] = useState(
    isCustomWidthValue ? String(item.width) : '',
  );

  useEffect(() => {
    if (typeof item.width === 'number' && !presetWidthValues.has(item.width)) {
      setCustomWidthActive(true);
      setCustomWidthInput(String(item.width));
    } else if (item.width === 'original') {
      setCustomWidthActive(false);
      setCustomWidthInput('');
    }
  }, [item.width, presetWidthValues]);

  // Early returns after all hooks
  if (needsFetch && loading && !item.url) {
    return (
      <div className={s.card}>
        <div className={s.loadingState}>
          <Spinner size={20} />
        </div>
      </div>
    );
  }

  if (needsFetch && (error || !upload) && !item.url) {
    return (
      <div className={s.card}>
        <div className={s.errorState}>
          <span>Failed to load</span>
          <button type="button" className={s.removeButton} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  const resolvedData = resolveCardData(item, upload);
  const aspectRatioState = computeAspectRatioState(item);
  const customWidthError = customWidthActive
    ? validateCustomWidth(customWidthInput)
    : undefined;

  return (
    <AssetCardContent
      item={item}
      widthOptions={widthOptions}
      onLayoutChange={onLayoutChange}
      onRemove={onRemove}
      onEditMetadata={onEditMetadata}
      onReplace={onReplace}
      disabled={disabled}
      enableCssClass={enableCssClass}
      enableLazyLoading={enableLazyLoading}
      resolvedData={resolvedData}
      aspectRatioState={aspectRatioState}
      widthOptionsWithCustom={widthOptionsWithCustom}
      customWidthActive={customWidthActive}
      customWidthInput={customWidthInput}
      customWidthError={customWidthError}
      setCustomWidthActive={setCustomWidthActive}
      setCustomWidthInput={setCustomWidthInput}
    />
  );
}

type AssetCardContentProps = {
  item: MediaLayoutItem;
  widthOptions: WidthOption[];
  onLayoutChange: (layout: Partial<MediaLayoutItem>) => void;
  onRemove: () => void;
  onEditMetadata: () => void;
  onReplace?: () => void;
  disabled?: boolean;
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  resolvedData: ResolvedCardData;
  aspectRatioState: ReturnType<typeof computeAspectRatioState>;
  widthOptionsWithCustom: { value: string | number; label: string }[];
  customWidthActive: boolean;
  customWidthInput: string;
  customWidthError: string | undefined;
  setCustomWidthActive: (active: boolean) => void;
  setCustomWidthInput: (input: string) => void;
};

function AssetCardContent({
  item,
  widthOptions,
  onLayoutChange,
  onRemove,
  onEditMetadata,
  onReplace,
  disabled,
  enableCssClass,
  enableLazyLoading,
  resolvedData,
  aspectRatioState,
  widthOptionsWithCustom,
  customWidthActive,
  customWidthInput,
  customWidthError,
  setCustomWidthActive,
  setCustomWidthInput,
}: AssetCardContentProps) {
  const { url, filename, format, originalWidth, originalHeight } = resolvedData;
  const {
    aspectRatioOptions,
    isCustomAspectRatio,
    customAspectRatioValue,
    customAspectRatioError,
    aspectLabel,
  } = aspectRatioState;

  const thumbnailUrl = url ? `${url}?auto=format&w=80&h=80&fit=crop` : '';
  const isImage = isImageFormat(format);
  const formatLabel = getFormatLabel(format);
  const focalX = item.focalPoint ? item.focalPoint.x * 100 : 50;
  const focalY = item.focalPoint ? item.focalPoint.y * 100 : 50;

  const ratio = getEffectiveRatio(
    item.aspectRatio,
    item.customAspectRatio,
    originalWidth,
    originalHeight,
  );
  const resolvedWidth = resolveWidthValue(item.width, originalWidth);
  const widthLabel = getWidthLabel(item.width, widthOptions);
  const cssClassValue = item.cssClass ?? '';
  const lazyLoadingValue = item.lazyLoading ?? false;
  const showExtraControls = enableCssClass || enableLazyLoading;

  return (
    <div className={s.card}>
      <div className={s.thumbnail}>
        {isImage && thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            style={{ objectPosition: `${focalX}% ${focalY}%` }}
          />
        ) : (
          <div className={s.filePlaceholder}>
            {formatLabel?.toUpperCase() || 'FILE'}
          </div>
        )}
      </div>

      <div className={s.info}>
        <span className={s.filename} title={filename}>
          {filename}
        </span>
        {ratio && ratio > 0 && resolvedWidth && (
          <span className={s.dimensions}>
            {formatDimensions(resolvedWidth, ratio)}
          </span>
        )}
      </div>

      <div className={s.actionStack}>
        <div className={s.controls}>
          <AspectRatioDropdown
            aspectLabel={aspectLabel}
            disabled={disabled}
            aspectRatioOptions={aspectRatioOptions}
            isCustomAspectRatio={isCustomAspectRatio}
            customAspectRatioValue={customAspectRatioValue}
            customAspectRatioError={customAspectRatioError}
            onLayoutChange={onLayoutChange}
          />

          <WidthDropdown
            widthLabel={widthLabel}
            disabled={disabled}
            widthOptionsWithCustom={widthOptionsWithCustom}
            customWidthActive={customWidthActive}
            customWidthInput={customWidthInput}
            customWidthError={customWidthError}
            item={item}
            resolvedWidth={resolvedWidth}
            setCustomWidthActive={setCustomWidthActive}
            setCustomWidthInput={setCustomWidthInput}
            onLayoutChange={onLayoutChange}
          />

          <Dropdown
            renderTrigger={({ onClick }) => (
              <button
                type="button"
                className={s.menuButton}
                onClick={onClick}
                disabled={disabled}
                aria-label="More actions"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <circle cx="8" cy="3" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>
            )}
          >
            <DropdownMenu>
              {onReplace && (
                <DropdownOption onClick={onReplace}>Replace</DropdownOption>
              )}
              <DropdownOption onClick={onEditMetadata}>
                Edit metadata
              </DropdownOption>
              <DropdownOption onClick={onRemove} red>
                Remove
              </DropdownOption>
            </DropdownMenu>
          </Dropdown>
        </div>

        {showExtraControls && (
          <div className={s.extraControls}>
            {enableCssClass && (
              <input
                type="text"
                className={s.cssClassInput}
                placeholder="CSS class"
                value={cssClassValue}
                onChange={(e) => onLayoutChange({ cssClass: e.target.value })}
                disabled={disabled}
              />
            )}
            {enableLazyLoading && (
              <label
                className={
                  disabled
                    ? `${s.lazyToggle} ${s.toggleDisabled}`
                    : s.lazyToggle
                }
              >
                <input
                  type="checkbox"
                  checked={lazyLoadingValue}
                  onChange={(e) =>
                    onLayoutChange({ lazyLoading: e.target.checked })
                  }
                  disabled={disabled}
                />
                <span className={s.toggleTrack} aria-hidden="true" />
                <span className={s.toggleLabel}>Lazy</span>
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type AspectRatioDropdownProps = {
  aspectLabel: string;
  disabled?: boolean;
  aspectRatioOptions: { value: string; label: string }[];
  isCustomAspectRatio: boolean;
  customAspectRatioValue: string;
  customAspectRatioError: string | undefined;
  onLayoutChange: (layout: Partial<MediaLayoutItem>) => void;
};

function AspectRatioDropdown({
  aspectLabel,
  disabled,
  aspectRatioOptions,
  isCustomAspectRatio,
  customAspectRatioValue,
  customAspectRatioError,
  onLayoutChange,
}: AspectRatioDropdownProps) {
  return (
    <>
      <Dropdown
        renderTrigger={({ onClick }) => (
          <button
            type="button"
            className={s.controlButton}
            onClick={onClick}
            disabled={disabled}
          >
            {aspectLabel}
          </button>
        )}
      >
        <DropdownMenu>
          {aspectRatioOptions.map((opt) => (
            <DropdownOption
              key={opt.value}
              onClick={() => {
                if (opt.value === 'custom') {
                  onLayoutChange({
                    aspectRatio: 'custom',
                    customAspectRatio: customAspectRatioValue || '',
                  });
                } else {
                  onLayoutChange({
                    aspectRatio: opt.value,
                    customAspectRatio: undefined,
                  });
                }
              }}
            >
              {opt.label}
            </DropdownOption>
          ))}
        </DropdownMenu>
      </Dropdown>

      {isCustomAspectRatio && (
        <div className={s.customAspectRatioField}>
          <input
            type="text"
            className={
              customAspectRatioError
                ? `${s.customAspectRatioInput} ${s.inputError}`
                : s.customAspectRatioInput
            }
            value={customAspectRatioValue}
            placeholder="2.35:1"
            onChange={(e) =>
              onLayoutChange({
                aspectRatio: 'custom',
                customAspectRatio: e.target.value,
              })
            }
            disabled={disabled}
          />
          {customAspectRatioError && (
            <span className={s.errorText}>{customAspectRatioError}</span>
          )}
        </div>
      )}
    </>
  );
}

type WidthDropdownProps = {
  widthLabel: string;
  disabled?: boolean;
  widthOptionsWithCustom: { value: string | number; label: string }[];
  customWidthActive: boolean;
  customWidthInput: string;
  customWidthError: string | undefined;
  item: MediaLayoutItem;
  resolvedWidth: number | null;
  setCustomWidthActive: (active: boolean) => void;
  setCustomWidthInput: (input: string) => void;
  onLayoutChange: (layout: Partial<MediaLayoutItem>) => void;
};

function WidthDropdown({
  widthLabel,
  disabled,
  widthOptionsWithCustom,
  customWidthActive,
  customWidthInput,
  customWidthError,
  item,
  resolvedWidth,
  setCustomWidthActive,
  setCustomWidthInput,
  onLayoutChange,
}: WidthDropdownProps) {
  function handleWidthOptionClick(optValue: string | number) {
    if (optValue === 'custom') {
      const fallback =
        typeof item.width === 'number'
          ? item.width
          : (resolvedWidth ?? DEFAULT_WIDTH);
      setCustomWidthActive(true);
      setCustomWidthInput(String(fallback));
      onLayoutChange({ width: fallback });
    } else {
      setCustomWidthActive(false);
      setCustomWidthInput('');
      onLayoutChange({
        width: optValue as MediaLayoutItem['width'],
      });
    }
  }

  function handleCustomWidthChange(value: string) {
    setCustomWidthInput(value);
    const parsed = parseCustomWidth(value);
    if (parsed !== null && !validateCustomWidth(value)) {
      onLayoutChange({ width: parsed });
    }
  }

  return (
    <>
      <Dropdown
        renderTrigger={({ onClick }) => (
          <button
            type="button"
            className={s.controlButton}
            onClick={onClick}
            disabled={disabled}
          >
            {widthLabel}
          </button>
        )}
      >
        <DropdownMenu>
          {widthOptionsWithCustom.map((opt) => (
            <DropdownOption
              key={opt.value}
              onClick={() => handleWidthOptionClick(opt.value)}
            >
              {opt.label}
            </DropdownOption>
          ))}
        </DropdownMenu>
      </Dropdown>

      {customWidthActive && (
        <div className={s.customWidthField}>
          <input
            type="number"
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            className={
              customWidthError
                ? `${s.customWidthInput} ${s.inputError}`
                : s.customWidthInput
            }
            value={customWidthInput}
            placeholder={String(DEFAULT_WIDTH)}
            onChange={(e) => handleCustomWidthChange(e.target.value)}
            disabled={disabled}
          />
          {customWidthError && (
            <span className={s.errorText}>{customWidthError}</span>
          )}
        </div>
      )}
    </>
  );
}
