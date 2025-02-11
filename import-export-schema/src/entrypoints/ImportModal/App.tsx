import { useState } from 'react';
import Export from '../ExportModal/Export';
import type { ExportDoc } from '../ExportModal/buildExportDoc';
import FileDropZone from './FileDropZone';
import { Import } from './Import';

export default function App() {
  const [exportDoc, setExportDoc] = useState<ExportDoc | undefined>();

  async function handleImport(doc: ExportDoc) {
    setExportDoc(doc);
  }

  return (
    <FileDropZone onJsonDrop={handleImport}>
      {exportDoc ? <Import exportDoc={exportDoc} /> : <Export />}
    </FileDropZone>
  );
}
