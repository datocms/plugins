import Button from 'datocms-react-ui/Button';
import EntityRow from 'datocms-react-ui/EntityRow';
import Pill from 'datocms-react-ui/Pill';
import RowList from 'datocms-react-ui/RowList';
import { useState } from 'react';
import type { Environment } from '../utils/assetEnvironmentOperations';
import styles from './styles.module.css';

const PAGE_SIZE = 100;

/**
 * The environments that have a copy of the asset, each opening that copy.
 * The frame already has an inset (its body padding), so the list is compact
 * (RowList, "Density"). A long list shows 100 rows at a time.
 */
export function EnvironmentList({
  environments,
  uploadId,
}: {
  environments: Environment[];
  uploadId: string;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const more = Math.min(PAGE_SIZE, environments.length - shown);

  return (
    <>
      <RowList density="compact">
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
      {more > 0 && (
        <div className={styles.actions}>
          <Button
            tone="ghost"
            label={{
              id: 'deleteAsset.moreEnvironments',
              values: { count: more },
            }}
            onClick={() => setShown((count) => count + PAGE_SIZE)}
          />
        </div>
      )}
    </>
  );
}
