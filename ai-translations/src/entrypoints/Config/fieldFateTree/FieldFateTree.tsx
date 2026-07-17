/**
 * FieldFateTree.tsx
 * -----------------
 * The projectwide field-fate tree (spec §3, §4). One collapsible `Section` per
 * model — collapsed by default, honest summary counts in the header — over the
 * two sparse token lists. The same component will serve the per-run modal in
 * phase 5 (spec §4); here it runs in config mode.
 */

import { useMemo, useState } from 'react';
import { Section, SwitchField } from 'datocms-react-ui';
import FieldFateTreeNode from './FieldFateTreeNode';
import { cascadeFate, fateOf, flattenLeaves, summarize } from './fate';
import type {
  FateLists,
  FateModelNode,
  FateSummary,
  FieldFate,
} from './types';
import s from './fieldFateTree.module.css';

const SET_ALL: FieldFate[] = ['translate', 'copy', 'skip'];

const summaryText = (summary: FateSummary): string =>
  `${summary.translate} translate · ${summary.copy} copy · ${summary.skip} skip`;

interface FieldFateTreeProps {
  models: FateModelNode[];
  lists: FateLists;
  onChange: (nextLists: FateLists) => void;
}

/** Usage note surfaced under the Set-all row after a required carve-out. */
interface ModelBodyProps {
  model: FateModelNode;
  lists: FateLists;
  onChange: (nextLists: FateLists) => void;
}

function ModelBody({ model, lists, onChange }: ModelBodyProps) {
  const [filter, setFilter] = useState('');
  const [note, setNote] = useState<string | undefined>();

  const leaves = useMemo(
    () => model.fields.flatMap(flattenLeaves),
    [model.fields],
  );

  const setAll = (fate: FieldFate) => {
    const { lists: next, keptRequired } = cascadeFate(leaves, fate, lists);
    setNote(
      keptRequired > 0
        ? `Set ${leaves.length - keptRequired} of ${leaves.length} — ${keptRequired} required field${
            keptRequired === 1 ? '' : 's'
          } kept as Translate`
        : undefined,
    );
    onChange(next);
  };

  const needle = filter.trim().toLowerCase();
  const visibleFields = needle
    ? model.fields.filter((field) => field.label.toLowerCase().includes(needle))
    : model.fields;

  return (
    <>
      <div className={s.toolbar}>
        <span className={s.setAll}>
          Set all:
          {SET_ALL.map((fate) => (
            <button
              key={fate}
              type="button"
              className={s.setAllButton}
              onClick={() => setAll(fate)}
            >
              {fate.charAt(0).toUpperCase() + fate.slice(1)}
            </button>
          ))}
        </span>
        <input
          type="search"
          className={s.modelFilter}
          value={filter}
          placeholder="Filter fields…"
          aria-label="Filter fields"
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {note && <div className={s.setAllNote}>{note}</div>}
      {visibleFields.map((field) => (
        <FieldFateTreeNode
          key={field.id}
          node={field}
          lists={lists}
          onChange={(nextLists) => onChange(nextLists)}
        />
      ))}
      {model.nonTranslatable.length > 0 && (
        <div className={s.footerLine}>
          {model.nonTranslatable.length} field
          {model.nonTranslatable.length === 1 ? '' : 's'} aren't translatable (
          {model.nonTranslatable.map((f) => f.label).join(', ')}) — always ignored
        </div>
      )}
    </>
  );
}

/**
 * Renders the fate tree across models.
 */
export default function FieldFateTree({
  models,
  lists,
  onChange,
}: FieldFateTreeProps) {
  const [openModelId, setOpenModelId] = useState<string | null>(null);
  const [nonDefaultOnly, setNonDefaultOnly] = useState(false);
  const [modelFilter, setModelFilter] = useState('');

  const needle = modelFilter.trim().toLowerCase();
  const visibleModels = models.filter((model) => {
    const matchesFilter =
      !needle ||
      model.name.toLowerCase().includes(needle) ||
      model.id.toLowerCase().includes(needle);
    const hasRule =
      !nonDefaultOnly ||
      model.fields
        .flatMap(flattenLeaves)
        .some((leaf) => fateOf(leaf, lists) !== 'translate');
    return matchesFilter && hasRule;
  });

  return (
    <div className={s.tree}>
      <div className={s.toolbar}>
        <input
          type="search"
          className={s.modelFilter}
          value={modelFilter}
          placeholder="Search models by name or ID…"
          aria-label="Search models by name or ID"
          onChange={(event) => setModelFilter(event.target.value)}
        />
        <SwitchField
          id="nonDefaultOnly"
          name="nonDefaultOnly"
          label="Show only models with a rule"
          value={nonDefaultOnly}
          onChange={setNonDefaultOnly}
        />
      </div>
      {visibleModels.length === 0 && (
        <div className={s.footerLine}>No models match “{modelFilter}”.</div>
      )}
      {visibleModels.map((model) => {
        const summary = summarize(
          model.fields.flatMap(flattenLeaves).map((leaf) => fateOf(leaf, lists)),
        );
        const isOpen = openModelId === model.id;
        return (
          <Section
            key={model.id}
            title={
              <span>
                {model.name}{' '}
                <span className={s.modelSummary}>{summaryText(summary)}</span>
              </span>
            }
            collapsible={{
              isOpen,
              onToggle: () => setOpenModelId(isOpen ? null : model.id),
            }}
          >
            {isOpen && (
              <ModelBody model={model} lists={lists} onChange={onChange} />
            )}
          </Section>
        );
      })}
    </div>
  );
}
