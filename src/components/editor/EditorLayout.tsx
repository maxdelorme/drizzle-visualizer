import React from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Button } from '@/components/ui/button';

interface EditorLayoutProps {
  sidebar: React.ReactNode;
  editor: React.ReactNode;
  canvas: React.ReactNode;
  controls: React.ReactNode;
  canvasOnly: boolean;
  onToggleCanvasOnly: () => void;
}

const EditorLayout: React.FC<EditorLayoutProps> = ({
  sidebar,
  editor,
  canvas,
  controls,
  canvasOnly,
  onToggleCanvasOnly,
}) => {
  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden">
      <div className="w-full h-14 shrink-0 border-b bg-background flex items-center justify-between px-4">
        <a href="/" className="flex items-center gap-2">
          <span className="font-semibold text-primary">
            Drizzle Schema Vision
          </span>
        </a>

        <Button variant="outline" size="sm" onClick={onToggleCanvasOnly}>
          {canvasOnly ? 'Exit Canvas Only' : 'Display Only Canvas'}
        </Button>
      </div>

      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
        {!canvasOnly && (
          <div className="w-64 shrink-0 border-r bg-background flex flex-col min-h-0">
            {sidebar}
          </div>
        )}

        {canvasOnly ? (
          <div className="flex-1 min-w-0 min-h-0 relative">
            <div className="h-full w-full overflow-hidden">{canvas}</div>
            <div className="absolute bottom-4 left-4 z-10">{controls}</div>
          </div>
        ) : (
          <PanelGroup direction="horizontal" className="flex-1 min-w-0 min-h-0">
            <Panel
              defaultSize={45}
              minSize={25}
              className="min-w-0 min-h-0 bg-editor-bg text-editor-text overflow-hidden flex flex-col border-r"
            >
              {editor}
            </Panel>

            <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors" />

            <Panel defaultSize={55} minSize={25} className="min-w-0 min-h-0 relative">
              <div className="h-full w-full overflow-hidden">{canvas}</div>
              <div className="absolute bottom-4 left-4 z-10">{controls}</div>
            </Panel>
          </PanelGroup>
        )}
      </div>
    </div>
  );
};

export default EditorLayout;
