import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { decodeState } from '@/lib/stateUtils';
import EditorLayout from '@/components/editor/EditorLayout';
import Sidebar from '@/components/editor/Sidebar';
import CodeEditor from '@/components/editor/CodeEditor';
import CanvasView from '@/components/editor/CanvasView';
import CanvasControls from '@/components/editor/CanvasControls';
import { toast } from 'sonner';
import { parseSchemaFromCode } from '@/lib/schemaParser';
import { Button } from '@/components/ui/button';
import { Database, Save } from 'lucide-react';

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
    references?: string;
  }[];
}

const Editor = () => {
  const [searchParams] = useSearchParams();
  const [appState, setAppState] = useState<AppState | null>(null);
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [showVisualizer, setShowVisualizer] = useState(true);
  const [lastSavedContents, setLastSavedContents] = useState<
    Record<string, string>
  >({});
  const autoVisualizeTimeoutRef = useRef<number | null>(null);
  const fileHandlesRef = useRef<Record<string, any>>({});

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

  // Visualize schema when actively triggered by user
  const handleVisualize = () => {
    if (!appState) return;

    const parsedTables = parseSchemaFromCode(appState.files);
    console.log('Visualizing tables:', parsedTables);
    setTables(parsedTables);

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
    <EditorLayout
      sidebar={
        <Sidebar
          files={appState.files}
          activeFile={appState.activeFile}
          onFileSelect={handleFileSelect}
          onCreateNewFile={handleCreateNewFile}
        />
      }
      editor={
        <div className="flex flex-col h-full">
          <div className="border-b p-2 flex justify-between items-center">
            <Button
              onClick={handleVisualize}
              size="sm"
              className="flex items-center gap-1"
            >
              <Database className="h-4 w-4" />
              Visualize Schema
            </Button>

            <div className="flex items-center gap-2">
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
            tables={tables}
            canvasState={appState.canvasState}
            onCanvasStateChange={handleCanvasStateChange}
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
  );
};

export default Editor;
