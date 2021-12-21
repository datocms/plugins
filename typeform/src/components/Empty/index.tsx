import { EmptyProps, Form } from "../../types";
import { Button } from "datocms-react-ui";

import style from "./styles.module.css";

export default function Empty({ ctx, onSelect }: EmptyProps) {
  const handleOpenModal = async () => {
    const result = (await ctx.openModal({
      id: "browseProducts",
      title: "Browse forms",
      width: "l",
    })) as { form: Form | null };

    onSelect({ form: result && result.form });
  };

  return (
    <div className={style.empty}>
      <div className={style.empty__label}>No Typeform selected</div>

      <Button onClick={handleOpenModal}>Browse</Button>
    </div>
  );
}
