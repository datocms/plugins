import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import EntityRow from 'datocms-react-ui/EntityRow';
import Pill from 'datocms-react-ui/Pill';
import RowList from 'datocms-react-ui/RowList';
import { type CSSProperties, useState } from 'react';
import type { Environment } from '../utils/assetEnvironmentOperations';
import styles from './styles.module.css';

const PAGE_SIZE = 100;

/**
 * The environments that have a copy of the asset, each opening that copy.
 * The frame already has an inset (its body padding), so the box of the list
 * goes out into it: the text of the rows stays in line with the text of the
 * panel (RowList, "The inset row"). A long list shows 100 rows at a time.
 */
export function EnvironmentList({
  environments,
  uploadId,
}: {
  environments: Environment[];
  uploadId: string;
}) {
  const { bodyPadding } = useCtx();
  const [, right = 0, , left = 0] = bodyPadding;
  const [shown, setShown] = useState(PAGE_SIZE);
  const more = Math.min(PAGE_SIZE, environments.length - shown);

  return (
    <>
      <div
        className={styles.rows}
        style={
          {
            '--frame-inset-left': `${left}px`,
            '--frame-inset-right': `${right}px`,
          } as CSSProperties
        }
      >
        <RowList>
          {environments.slice(0, shown).map((env) => (
            <RowList.Item
              key={env.id}
              to={
                env.meta.primary
                  ? `/media/assets/${uploadId}`
                  : `/environments/${env.id}/media/assets/${uploadId}`
              }
            >
              <EntityRow
                layout="row"
                title={env.id}
                afterTitle={env.meta.primary ? <Pill>Primary</Pill> : undefined}
              />
            </RowList.Item>
          ))}
        </RowList>
      </div>
      {more > 0 && (
        <div className={styles.actions}>
          <Button
            tone="ghost"
            label={`Show ${more} more ${more === 1 ? 'environment' : 'environments'}`}
            onClick={() => setShown((count) => count + PAGE_SIZE)}
          />
        </div>
      )}
    </>
  );
}
