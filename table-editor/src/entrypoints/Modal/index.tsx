import type { RenderModalCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import { useState } from 'react';
import { Empty } from '../../components/Empty';
import TableEditor from '../../components/TableEditor';
import type { Value } from '../../types';
import s from './style.module.css';

type Props = {
  ctx: RenderModalCtx;
};

export default function Modal({ ctx }: Props) {
  const [value, setValue] = useState<Value | null>(
    ctx.parameters.value as Value,
  );

  const handleClose = () => {
    ctx.resolve('abort');
  };

  const handleSave = () => {
    ctx.resolve(value);
  };

  return (
    <>
      {value === null ? (
        <Empty onChange={setValue} />
      ) : (
        <TableEditor value={value} onChange={setValue} />
      )}
      <div className={s.footer}>
        <Button tone="ghost" label="Cancel" onClick={handleClose} />
        <Button tone="primary" label="Save" onClick={handleSave} />
      </div>
    </>
  );
}
