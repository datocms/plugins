import { RenderModalCtx } from "datocms-plugin-sdk";
import { Button, Canvas } from "datocms-react-ui";
import { useState } from "react";
import { Empty } from "../../components/Empty";
import TableEditor from "../../components/TableEditor";
import { Value } from "../../types";
import s from "./style.module.css";

type Props = {
  ctx: RenderModalCtx;
};

export default function Modal({ ctx }: Props) {
  const [value, setValue] = useState<Value | null>(
    ctx.parameters.value as Value
  );

  const handleClose = () => {
    ctx.resolve("abort");
  };

  const handleSave = () => {
    ctx.resolve(value);
  };

  return (
    <Canvas ctx={ctx}>
      {value === null ? (
        <Empty onChange={setValue} />
      ) : (
        <TableEditor value={value} onChange={setValue} />
      )}
      <div className={s.bar}>
        <Button onClick={handleClose}>Cancel</Button>{" "}
        <div className={s.barSpacer} />
        <Button buttonType="primary" onClick={handleSave}>
          Save and close
        </Button>
      </div>
    </Canvas>
  );
}
