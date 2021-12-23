import { Button, useCtx } from 'datocms-react-ui';
import s from './styles.module.css';
import { Product } from '../../utils/CommerceLayerClient';
import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch } from '@fortawesome/free-solid-svg-icons';

export type EmptyProps = {
  onSelect: (product: Product) => void;
};

export default function Empty({ onSelect }: EmptyProps) {
  const ctx = useCtx<RenderFieldExtensionCtx>();

  const handleOpenModal = async () => {
    const product = (await ctx.openModal({
      id: 'browseProducts',
      title: 'Browse Commerce Layer SKUs',
      width: 'xl',
    })) as Product | null;

    if (product) {
      onSelect(product);
    }
  };

  return (
    <div className={s['empty']}>
      <div className={s['empty__label']}>No SKU selected!</div>
      <Button
        onClick={handleOpenModal}
        buttonSize="s"
        leftIcon={<FontAwesomeIcon icon={faSearch} />}
      >
        Browse Commerce Layer SKUs
      </Button>
    </div>
  );
}
