import { EmptyProps, Product } from "../../types";
import { Button } from "datocms-react-ui";

import style from "./styles.module.css";

export default function Empty({ ctx, onSelect }: EmptyProps) {
  const handleOpenModal = async () => {
    const { product } = (await ctx.openModal({
      id: "browseProducts",
      title: "Browse products",
      width: "l",
    })) as { product: Product | null };

    onSelect({ product });
  };

  return (
    <div className={style.empty}>
      <div className={style.empty__label}>No product selected</div>

      <Button onClick={handleOpenModal}>Browse</Button>
    </div>
  );
}
