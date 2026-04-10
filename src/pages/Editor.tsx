import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { decodeState } from '@/lib/stateUtils';
import EditorLayout from '@/components/editor/EditorLayout';
import Sidebar from '@/components/editor/Sidebar';
import CodeEditor from '@/components/editor/CodeEditor';
import CanvasView, { type CanvasViewHandle } from '@/components/editor/CanvasView';
import CanvasControls from '@/components/editor/CanvasControls';
import { toast } from 'sonner';
import { parseSchemaFromCode } from '@/lib/schemaParser';
import {
  buildLayoutFromPositions,
  parseSchemaLayout,
  SCHEMA_LAYOUT_FILENAME,
  stringifySchemaLayout,
} from '@/lib/schemaLayout';
import { Button } from '@/components/ui/button';
import { Database, Link2, RefreshCw, Save } from 'lucide-react';

export interface AppFile {
  name: string;
  content: string;
}

export interface AppState {
  files: AppFile[];
  activeFile: string | null;
  canvasState: {
    zoom: number;
    position: { x: number; y: number };
  };
}

export interface SchemaTable {
  name: string;
  columns: {
    name: string;
    type: string;
    isPrimary: boolean;
    isForeign: boolean;
    isIndexed: boolean;
    references?: string;
  }[];
}

const Editor = () => {
  const [searchParams] = useSearchParams();
  const [appState, setAppState] = useState<AppState | null>(null);
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [showVisualizer, setShowVisualizer] = useState(true);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const [relationStyle, setRelationStyle] = useState<'curved' | 'straight'>(
    'straight',
  );
  const [layoutPositionsDirty, setLayoutPositionsDirty] = useState(false);
  const [layoutApplyRequest, setLayoutApplyRequest] = useState<{
    requestId: number;
    tables: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [linkedFileName, setLinkedFileName] = useState<string | null>(null);
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(false);
  const [lastSavedContents, setLastSavedContents] = useState<
    Record<string, string>
  >({});
  const autoVisualizeTimeoutRef = useRef<number | null>(null);
  const fileHandlesRef = useRef<Record<string, any>>({});
  const linkedFileHandleRef = useRef<any | null>(null);
  const lastLinkedFileContentRef = useRef<string>('');
  const canvasViewRef = useRef<CanvasViewHandle>(null);
  const layoutSaveFileHandleRef = useRef<any | null>(null);
  const layoutLoadInputRef = useRef<HTMLInputElement>(null);
  const layoutApplyIdRef = useRef(0);

  useEffect(() => {
    const stateParam = searchParams.get('state');

    if (stateParam) {
      try {
        const decodedState = decodeState<AppState>(stateParam);
        setAppState(decodedState);
        setLastSavedContents(
          decodedState.files.reduce<Record<string, string>>((acc, file) => {
            acc[file.name] = file.content;
            return acc;
          }, {}),
        );
      } catch (error) {
        console.error('Failed to decode state:', error);
        toast('Error loading data', {
          description:
            'Failed to load the shared schema. The URL might be corrupted.',
        });
      }
    }
  }, [searchParams]);

  const hasUnsavedChanges = useMemo(() => {
    if (!appState) return false;
    return appState.files.some((file) => lastSavedContents[file.name] !== file.content);
  }, [appState, lastSavedContents]);
  const hasFileSystemApi = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof (
        window as Window & {
          showOpenFilePicker?: unknown;
        }
      ).showOpenFilePicker === 'function',
    [],
  );

  // Visualize schema when actively triggered by user
  const applyLayoutFromParsed = (parsed: { tables: Record<string, { x: number; y: number }> }) => {
    layoutApplyIdRef.current += 1;
    setLayoutApplyRequest({
      requestId: layoutApplyIdRef.current,
      tables: parsed.tables,
    });
    setLayoutPositionsDirty(false);
  };

  const handleSaveLayoutPositions = async () => {
    const positions = canvasViewRef.current?.getTablePositions() ?? {};
    const tablesOnly: Record<string, { x: number; y: number }> = {};
    tables.forEach((t) => {
      const p = positions[t.name];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        tablesOnly[t.name] = { x: p.x, y: p.y };
      }
    });

    const json = stringifySchemaLayout(buildLayoutFromPositions(tablesOnly));

    try {
      const w = window as Window & {
        showSaveFilePicker?: (options?: Record<string, unknown>) => Promise<any>;
      };

      const handle =
        layoutSaveFileHandleRef.current ||
        (w.showSaveFilePicker
          ? await w.showSaveFilePicker({
              suggestedName: SCHEMA_LAYOUT_FILENAME,
              types: [
                {
                  description: 'Schema layout',
                  accept: { 'application/json': ['.json'] },
                },
              ],
            })
          : null);

      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        layoutSaveFileHandleRef.current = handle;
      } else {
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = SCHEMA_LAYOUT_FILENAME;
        link.click();
        URL.revokeObjectURL(url);
      }

      setLayoutPositionsDirty(false);
      toast('Layout saved', {
        description: SCHEMA_LAYOUT_FILENAME,
      });
    } catch (error) {
      console.error('Failed to save layout:', error);
      toast('Layout save canceled or failed', {
        description: 'No layout file was written.',
      });
    }
  };

  const handleLoadLayoutFromText = (text: string) => {
    const parsed = parseSchemaLayout(text);
    if (!parsed) {
      toast('Invalid layout file', {
        description: `Expected ${SCHEMA_LAYOUT_FILENAME} with version 1 and a tables object.`,
      });
      return;
    }
    applyLayoutFromParsed(parsed);
    toast('Layout loaded', {
      description: 'Table positions were updated from the file.',
    });
  };

  const handleLoadLayoutPositions = async () => {
    if (hasFileSystemApi) {
      try {
        const w = window as Window & {
          showOpenFilePicker?: (options?: Record<string, unknown>) => Promise<any[]>;
        };
        const [handle] =
          (await w.showOpenFilePicker?.({
            multiple: false,
            types: [
              {
                description: 'Schema layout',
                accept: { 'application/json': ['.json'] },
              },
            ],
          })) ?? [];
        if (!handle) return;
        const file = await handle.getFile();
        const text = await file.text();
        handleLoadLayoutFromText(text);
      } catch (error) {
        console.error('Failed to load layout:', error);
        toast('Layout load canceled', {
          description: 'No layout file was loaded.',
        });
      }
    } else {
      layoutLoadInputRef.current?.click();
    }
  };

  const handleVisualize = () => {
    if (!appState) return;

    const parsedTables = parseSchemaFromCode(appState.files);
    console.log('Visualizing tables:', parsedTables);
    setTables(parsedTables);
    setLayoutVersion((prev) => prev + 1);
    setLayoutPositionsDirty(false);

    // Show visualizer if hidden
    setShowVisualizer(true);

    // Give feedback to user
    if (parsedTables.length === 0) {
      toast('No tables found', {
        description:
          'No valid Drizzle schema tables were detected in your code.',
      });
    } else {
      toast(`Visualization updated`, {
        description: `Found ${parsedTables.length} tables in your schema.`,
      });
    }
  };

  const handleSave = async () => {
    if (!appState || !appState.activeFile) return;

    const activeFile = appState.files.find((file) => file.name === appState.activeFile);
    if (!activeFile) return;

    try {
      const windowWithFS = window as Window & {
        showSaveFilePicker?: (options?: Record<string, unknown>) => Promise<any>;
      };

      const existingHandle = fileHandlesRef.current[activeFile.name];
      const fileHandle =
        existingHandle ||
        (windowWithFS.showSaveFilePicker
          ? await windowWithFS.showSaveFilePicker({
              suggestedName: activeFile.name,
              types: [
                {
                  description: 'TypeScript/JavaScript files',
                  accept: {
                    'text/plain': ['.ts', '.tsx', '.js', '.jsx'],
                  },
                },
              ],
            })
          : null);

      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(activeFile.content);
        await writable.close();
        fileHandlesRef.current[activeFile.name] = fileHandle;
      } else {
        const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = activeFile.name;
        link.click();
        URL.revokeObjectURL(url);
      }

      setLastSavedContents((prev) => ({
        ...prev,
        [activeFile.name]: activeFile.content,
      }));
      if (linkedFileName === activeFile.name) {
        lastLinkedFileContentRef.current = activeFile.content;
      }

      toast('File saved', {
        description: `${activeFile.name} was saved successfully.`,
      });
    } catch (error) {
      console.error('Failed to save file:', error);
      toast('Save canceled or failed', {
        description: 'No file was saved.',
      });
    }
  };

  const upsertFileInState = (fileName: string, content: string) => {
    setAppState((prevState) => {
      if (!prevState) return prevState;

      const existingIndex = prevState.files.findIndex((file) => file.name === fileName);
      if (existingIndex > -1) {
        const nextFiles = [...prevState.files];
        nextFiles[existingIndex] = { ...nextFiles[existingIndex], content };
        return { ...prevState, files: nextFiles, activeFile: fileName };
      }

      return {
        ...prevState,
        files: [...prevState.files, { name: fileName, content }],
        activeFile: fileName,
      };
    });
  };

  const handleLinkSchemaFile = async () => {
    try {
      const windowWithFS = window as Window & {
        showOpenFilePicker?: (options?: Record<string, unknown>) => Promise<any[]>;
      };

      if (!windowWithFS.showOpenFilePicker) {
        toast('File linking not supported', {
          description: 'Your browser does not support the File System Access API.',
        });
        return;
      }

      const [fileHandle] = await windowWithFS.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Schema files',
            accept: { 'text/plain': ['.ts', '.tsx', '.js', '.jsx'] },
          },
        ],
      });
      if (!fileHandle) return;

      const file = await fileHandle.getFile();
      const content = await file.text();

      linkedFileHandleRef.current = fileHandle;
      lastLinkedFileContentRef.current = content;
      setLinkedFileName(file.name);
      setAutoReloadEnabled(true);

      upsertFileInState(file.name, content);
      setLastSavedContents((prev) => ({ ...prev, [file.name]: content }));

      toast('Schema file linked', {
        description: `${file.name} is now watched for changes.`,
      });
    } catch (error) {
      console.error('Failed to link schema file:', error);
      toast('File selection canceled', {
        description: 'No external file was linked.',
      });
    }
  };

  useEffect(() => {
    if (!appState || !showVisualizer) return;

    if (autoVisualizeTimeoutRef.current) {
      window.clearTimeout(autoVisualizeTimeoutRef.current);
    }

    autoVisualizeTimeoutRef.current = window.setTimeout(() => {
      const parsedTables = parseSchemaFromCode(appState.files);

      if (parsedTables.length > 0) {
        setTables(parsedTables);
        return;
      }

      // If there is no schema-like content, clear the canvas. Otherwise keep
      // the last valid diagram while the user is mid-edit.
      const hasSchemaLikeCode = appState.files.some((file) =>
        /(?:Table|pgTable)\s*\(/.test(file.content),
      );
      if (!hasSchemaLikeCode) {
        setTables([]);
      }
    }, 300);

    return () => {
      if (autoVisualizeTimeoutRef.current) {
        window.clearTimeout(autoVisualizeTimeoutRef.current);
      }
    };
  }, [appState?.files, showVisualizer]);

  useEffect(() => {
    if (!autoReloadEnabled || !linkedFileHandleRef.current) return;

    const intervalId = window.setInterval(async () => {
      const handle = linkedFileHandleRef.current;
      if (!handle) return;

      try {
        const file = await handle.getFile();
        const content = await file.text();
        if (content === lastLinkedFileContentRef.current) return;

        lastLinkedFileContentRef.current = content;
        upsertFileInState(file.name, content);
        setLastSavedContents((prev) => ({ ...prev, [file.name]: content }));

        toast('External schema reloaded', {
          description: `${file.name} changed on disk and was reloaded.`,
        });
      } catch (error) {
        console.error('Auto-reload failed:', error);
      }
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [autoReloadEnabled]);

  const handleFileSelect = (fileName: string) => {
    if (!appState) return;

    setAppState({
      ...appState,
      activeFile: fileName,
    });
  };

  const handleFileContentChange = (fileName: string, newContent: string) => {
    if (!appState) return;

    const updatedFiles = appState.files.map((file) =>
      file.name === fileName ? { ...file, content: newContent } : file,
    );

    const updatedState = {
      ...appState,
      files: updatedFiles,
    };

    setAppState(updatedState);
  };

  const handleCreateNewFile = (fileName: string) => {
    if (!appState) return;

    // Check if file already exists
    if (appState.files.some((file) => file.name === fileName)) {
      toast('File already exists', {
        description: `The file ${fileName} already exists.`,
      });
      return;
    }

    const updatedFiles = [
      ...appState.files,
      { name: fileName, content: '// Add your schema here' },
    ];

    setAppState({
      ...appState,
      files: updatedFiles,
      activeFile: fileName,
    });
  };

  const handleCanvasStateChange = (newCanvasState: AppState['canvasState']) => {
    if (!appState) return;

    setAppState({
      ...appState,
      canvasState: newCanvasState,
    });
  };

  const toggleVisualizer = () => {
    if (!showVisualizer) {
      handleVisualize(); // Visualize data when showing
    } else {
      setShowVisualizer(false);
    }
  };

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  if (!appState) {
    return (
      <div className="h-screen flex items-center justify-center bg-muted">
        <div className="animate-pulse text-muted-foreground">
          Loading editor...
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={layoutLoadInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            const text = await file.text();
            handleLoadLayoutFromText(text);
          } catch (error) {
            console.error('Failed to read layout file:', error);
            toast('Could not read file', {
              description: 'Please try another layout file.',
            });
          }
        }}
      />
      <EditorLayout
      canvasOnly={canvasOnly}
      onToggleCanvasOnly={() => setCanvasOnly((prev) => !prev)}
      relationStyle={relationStyle}
      onToggleRelationStyle={() =>
        setRelationStyle((prev) => (prev === 'curved' ? 'straight' : 'curved'))
      }
      onSaveLayoutPositions={handleSaveLayoutPositions}
      onLoadLayoutPositions={handleLoadLayoutPositions}
      canSaveLayoutPositions={layoutPositionsDirty && tables.length > 0}
      sidebar={
        <Sidebar
          files={appState.files}
          activeFile={appState.activeFile}
          onFileSelect={handleFileSelect}
          onCreateNewFile={handleCreateNewFile}
        />
      }
      editor={
        <div className="flex flex-col h-full min-h-0">
          <div className="border-b p-2 flex justify-between items-center">
            <Button
              onClick={handleVisualize}
              size="sm"
              className="flex items-center gap-1"
            >
              <Database className="h-4 w-4" />
              Auto Layout Schema
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant={linkedFileName ? 'secondary' : 'outline'}
                size="sm"
                className="flex items-center gap-1"
                onClick={handleLinkSchemaFile}
                disabled={!hasFileSystemApi}
              >
                <Link2 className="h-4 w-4" />
                {linkedFileName ? `Linked: ${linkedFileName}` : 'Link schema.ts'}
              </Button>

              <Button
                variant={autoReloadEnabled ? 'secondary' : 'outline'}
                size="sm"
                className="flex items-center gap-1"
                onClick={() => setAutoReloadEnabled((prev) => !prev)}
                disabled={!linkedFileName}
              >
                <RefreshCw className="h-4 w-4" />
                {autoReloadEnabled ? 'Auto reload ON' : 'Auto reload OFF'}
              </Button>

              <Button
                variant={hasUnsavedChanges ? 'default' : 'outline'}
                size="sm"
                className="flex items-center gap-1"
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
              >
                <Save className="h-4 w-4" />
                Save
              </Button>

              <Button variant="outline" size="sm" onClick={toggleVisualizer}>
                {showVisualizer ? 'Hide Visualizer' : 'Show Visualizer'}
              </Button>
            </div>
          </div>

          <CodeEditor
            files={appState.files}
            activeFile={appState.activeFile}
            onContentChange={handleFileContentChange}
          />
        </div>
      }
      canvas={
        showVisualizer ? (
          <CanvasView
            ref={canvasViewRef}
            tables={tables}
            layoutVersion={layoutVersion}
            relationStyle={relationStyle}
            canvasState={appState.canvasState}
            onCanvasStateChange={handleCanvasStateChange}
            applyLayoutRequest={layoutApplyRequest}
            onTablesManuallyMoved={() => setLayoutPositionsDirty(true)}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-muted">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">Visualizer is hidden</p>
              <Button onClick={toggleVisualizer}>Show Visualizer</Button>
            </div>
          </div>
        )
      }
      controls={
        showVisualizer ? (
          <CanvasControls
            canvasState={appState.canvasState}
            onCanvasStateChange={handleCanvasStateChange}
            appState={appState}
          />
        ) : null
      }
    />
    </>
  );
};

export default Editor;
