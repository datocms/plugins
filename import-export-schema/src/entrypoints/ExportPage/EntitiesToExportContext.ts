import { createContext } from 'react';
import type { ExportSelection } from './exportState';

/** The selection of the export, for the nodes of its graph and its overview */
export const EntitiesToExportContext = createContext<
  undefined | ExportSelection
>(undefined);
