import { useCallback, useEffect, useMemo } from 'react';
import { normalizeConfig } from '../../types';
import { useCtx } from 'datocms-react-ui';
import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import CommerceLayerClient from '../../utils/CommerceLayerClient';
import useStore, { State } from '../../utils/useStore';
import s from './styles.module.css';
import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faExternalLinkAlt,
  faTimesCircle,
} from '@fortawesome/free-solid-svg-icons';

const fetchProductByCodeSelector = (state: State) => state.fetchProductByCode;

export type ValueProps = {
  value: string;
  onReset: () => void;
};

export default function Value({ value, onReset }: ValueProps) {
  const ctx = useCtx<RenderFieldExtensionCtx>();

  const { baseEndpoint, clientId } = normalizeConfig(
    ctx.plugin.attributes.parameters,
  );

  const client = useMemo(
    () => new CommerceLayerClient({ baseEndpoint, clientId }),
    [baseEndpoint, clientId],
  );

  const { product, status } = useStore(
    useCallback((state) => state.getProduct(value), [value]),
  );

  const fetchProductByCode = useStore(fetchProductByCodeSelector);

  useEffect(() => {
    fetchProductByCode(client, value);
  }, [client, value, fetchProductByCode]);

  return (
    <div
      className={classNames(s['value'], {
        [s['loading']]: status === 'loading',
      })}
    >
      {status === 'error' && (
        <div className={s['product']}>
          API Error! Could not fetch details for product:&nbsp;
          <code>{value}</code>
        </div>
      )}
      {product && (
        <div className={s['product']}>
          <div
            className={s['product__image']}
            style={{ backgroundImage: `url(${product.attributes.image_url})` }}
          />
          <div className={s['product__info']}>
            <div className={s['product__title']}>
              <a
                href={`${baseEndpoint}/admin/skus/${product.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {product.attributes.name}
              </a>
              <FontAwesomeIcon icon={faExternalLinkAlt} />
            </div>
            <div className={s['product__producttype']}>
              <strong>SKU:</strong>
              &nbsp;
              {product.attributes.code}
            </div>
            <div className={s['product__producttype']}>
              <strong>Description:</strong>
              &nbsp;
              {product.attributes.description}
            </div>
          </div>
        </div>
      )}
      <button type="button" onClick={onReset} className={s['reset']}>
        <FontAwesomeIcon icon={faTimesCircle} />
      </button>
    </div>
  );
}
