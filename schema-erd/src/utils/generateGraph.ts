import { Field, ItemType } from 'datocms-plugin-sdk';
import { Digraph, Edge, Node, Subgraph, toDot } from 'ts-graphviz';
import Viz from 'viz.js';
import { Module, render } from 'viz.js/full.render.js';

const fieldTypeValidators: Partial<Record<string, string[]>> = {
  link: ['item_item_type'],
  links: ['items_item_type'],
  rich_text: ['rich_text_blocks'],
  structured_text: ['structured_text_blocks', 'structured_text_links'],
};

const fieldTypes: Record<string, string> = {
  boolean: 'Boolean',
  color: 'Color',
  date: 'Date',
  date_time: 'DateTime',
  file: 'Single asset',
  float: 'Floating-point number',
  gallery: 'Asset gallery',
  image: 'Image',
  integer: 'Integer number',
  json: 'JSON',
  lat_lon: 'Geolocation',
  link: 'Single link',
  links: 'Multiple links',
  rich_text: 'Modular content',
  seo: 'SEO meta tags',
  slug: 'Slug',
  string: 'Single-line string',
  structured_text: 'Structured text',
  text: 'Multiple-paragraph text',
  video: 'External video',
};

export function allEntities<T>(dictionary: Partial<Record<string, T>>) {
  return Object.values(dictionary) as T[];
}

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateGraph({
  itemTypes,
  fields,
}: {
  itemTypes: Partial<Record<string, ItemType>>;
  fields: Partial<Record<string, Field>>;
}) {
  const graph = new Digraph('schema', false, {
    fontname: 'Arial',
    fontsize: 13,
    labelloc: 't',
    pad: '%0.4,%0.4',
    rankdir: 'LR',
    nodesep: 1,
    compound: true,
  });

  graph.attributes.node.apply({
    fontsize: 10,
    fontname: 'Arial',
    margin: '%0.07,%0.05',
    penwidth: 1.0,
  });

  graph.attributes.edge.apply({
    fontname: 'Arial',
    fontsize: 7,
    labelangle: 32,
    labeldistance: 1.8,
    arrowtail: 'none',
    color: 'grey60',
  });

  allEntities(itemTypes).forEach((itemType) => {
    const subgraph = new Subgraph(`cluster-${itemType.id}`, {
      style: 'filled',
      color: '#f5fbfc',
    });

    subgraph.attributes.node.apply({
      fillcolor: 'white',
      style: 'filled',
    });

    const node = new Node(`it-${itemType.id}`, {
      label: `<
        <table border="0" align="center" cellspacing="0.5" cellpadding="0">
          <tr>
            <td align="center" valign="bottom">
              <b><font point-size="11">${escapeHtml(
                itemType.attributes.name,
              )}</font></b>     <font color="grey50">${
        itemType.attributes.modular_block ? 'Block model' : 'Model'
      }</font>
              <br/>
              <font color="grey50" face="Courier">${escapeHtml(
                itemType.attributes.api_key,
              )}</font>
            </td>
          </tr>
        </table>
      >`,
      shape: itemType.attributes.singleton ? 'record' : 'Mrecord',
    });
    subgraph.addNode(node);

    const itemTypeFields = itemType.relationships.fields.data
      .map((handle) => fields[handle.id])
      .filter((x): x is Field => Boolean(x));

    itemTypeFields.forEach((field) => {
      const validators = fieldTypeValidators[field.attributes.field_type];

      if (!validators) {
        return;
      }

      let found = false;

      validators.forEach((validatorCode) => {
        const itemTypeIds: string[] = (
          field.attributes.validators[validatorCode] as any
        ).item_types;

        itemTypeIds.forEach((itemTypeId) => {
          found = true;
          const edge = new Edge(
            [{ id: `f-${field.id}` }, { id: `it-${itemTypeId}` }],
            { style: 'dashed', lhead: `cluster-${itemTypeId}` },
          );
          graph.addEdge(edge);
        });
      });

      if (found) {
        const node = new Node(`f-${field.id}`, {
          label: `<
            <table border="0">
              <tr>
                <td align="text">
                  <b>${escapeHtml(field.attributes.label)}</b>
                  <br/>
                  <font color="grey50">${
                    fieldTypes[field.attributes.field_type]
                  }</font>
                  <br/>
                  <font color="grey50" face="Courier">${escapeHtml(
                    field.attributes.api_key,
                  )}</font>
                </td>
              </tr>
            </table>
          >`.replace(/\s+/, ' '),
          color: '#429e9e',
          shape: 'record',
          fixedsize: true,
          width: 2,
          height: 0.6,
        });
        subgraph.addNode(node);

        const edge = new Edge([
          { id: `it-${itemType.id}` },
          { id: `f-${field.id}` },
        ]);
        graph.addEdge(edge);
      }
    });

    graph.addSubgraph(subgraph);
  });

  const dot = toDot(graph);

  return dot;
}

let viz = new Viz({ Module, render });

export async function withViz<T>(cb: (viz: Viz) => Promise<T>): Promise<T> {
  try {
    return await cb(viz);
  } catch (e) {
    // Syntax errors can sometimes cause the Graphviz DOT parsing code to enter an error state it can't recover from
    viz = new Viz({ Module, render });
    console.error(e);
    throw e;
  }
}

export function download(filename: string, dataUrl: string) {
  const element = document.createElement('a');

  element.setAttribute('href', dataUrl);
  element.setAttribute('download', filename);

  element.style.display = 'none';
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}
