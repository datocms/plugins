import {
  type FieldEdge,
  FieldEdgeRenderer,
} from '@/components/FieldEdgeRenderer';
import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';
import type { EdgeTypes } from '@xyflow/react';

export type AppNode = ItemTypeNode | PluginNode;

export type AppEdge = FieldEdge;

export const edgeTypes: EdgeTypes = {
  field: FieldEdgeRenderer,
};

export type Graph = {
  nodes: Array<AppNode>;
  edges: Array<AppEdge>;
};
