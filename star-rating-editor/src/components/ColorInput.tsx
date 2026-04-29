import { useCtx } from 'datocms-react-ui';
import { BlockPicker } from 'react-color';
import { defaultStarsColor } from '../utils/globalParams';
import s from './ColorInput.module.css';

type ColorInputProps = {
  value: string | undefined;
  onChange: (newValue: string) => void;
};

export default function ColorInput({ value, onChange }: ColorInputProps) {
  const ctx = useCtx();
  const { accentColor, primaryColor } = ctx.theme;

  return (
    <div className={s.wrapper}>
    <BlockPicker
      color={value}
      colors={[
        accentColor,
        primaryColor,
        '#E91E63',
        '#9C27B0',
        '#673AB7',
        '#3F51B5',
        '#2196F3',
        '#03A9F4',
        '#00BCD4',
        '#009688',
        '#4CAF50',
        '#8BC34A',
        '#CDDC39',
        defaultStarsColor,
        '#FF9800',
        '#FF5722',
        '#795548',
        '#607D8B',
        '#969696',
      ]}
      triangle="hide"
      width={'100%'}
      styles={{
        default: {
          card: {
            background: 'var(--color--surface)',
            border: '1px solid var(--color--border)',
            boxShadow: 'none',
          },
          body: {
            background: 'var(--color--surface)',
          },
          input: {
            background: 'var(--color--surface-muted)',
            color: 'var(--color--ink)',
            boxShadow: 'none',
            border: '1px solid var(--color--border)',
          },
          label: {
            color: 'var(--color--ink-subtle)',
          },
        },
      }}
      onChangeComplete={(color) => onChange(color.hex)}
    />
    </div>
  );
}
