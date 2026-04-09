import { useEffect, useRef, useState } from 'react';
import { AppState, SchemaTable } from '@/pages/Editor';

interface CanvasViewProps {
  tables: SchemaTable[];
  layoutVersion: number;
  canvasState: AppState['canvasState'];
  onCanvasStateChange: (newState: AppState['canvasState']) => void;
}

let persistedTablePositions: Record<string, { x: number; y: number }> = {};
let persistedLayoutVersion = 0;

const TABLE_WIDTH = 240;
const TABLE_HEADER_HEIGHT = 40;
const TABLE_ROW_HEIGHT = 34;
const TABLE_ROW_GAP = 90;
const TABLE_COLUMN_GAP = 140;
const CANVAS_MARGIN = 50;
const LANDSCAPE_ASPECT_RATIO = 1.7;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

const getTableHeight = (table: SchemaTable) =>
  TABLE_HEADER_HEIGHT + table.columns.length * TABLE_ROW_HEIGHT;

const getColumnY = (tableTop: number, columnIndex: number) =>
  tableTop +
  TABLE_HEADER_HEIGHT +
  (columnIndex > -1 ? columnIndex * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2 : 0);

const buildRelationLayout = (tables: SchemaTable[]) => {
  const tableByName = new Map(tables.map((table) => [table.name, table]));
  const tableNames = tables.map((table) => table.name);
  const inDegree = new Map<string, number>(tableNames.map((name) => [name, 0]));
  const outgoing = new Map<string, Set<string>>(
    tableNames.map((name) => [name, new Set<string>()]),
  );

  tables.forEach((table) => {
    table.columns.forEach((column) => {
      if (!column.isForeign || !column.references) return;
      if (!tableByName.has(column.references) || column.references === table.name) {
        return;
      }

      const neighbors = outgoing.get(table.name);
      if (!neighbors || neighbors.has(column.references)) return;

      neighbors.add(column.references);
      inDegree.set(column.references, (inDegree.get(column.references) ?? 0) + 1);
    });
  });

  const levelByTable = new Map<string, number>();
  const queue: string[] = tableNames.filter((name) => (inDegree.get(name) ?? 0) === 0);

  queue.forEach((name) => levelByTable.set(name, 0));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levelByTable.get(current) ?? 0;
    const neighbors = outgoing.get(current) ?? new Set<string>();

    neighbors.forEach((next) => {
      const nextLevel = Math.max(levelByTable.get(next) ?? 0, currentLevel + 1);
      levelByTable.set(next, nextLevel);

      inDegree.set(next, (inDegree.get(next) ?? 1) - 1);
      if ((inDegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    });
  }

  // Fallback for cycles/unvisited nodes: place them after known levels.
  const maxKnownLevel = Math.max(...Array.from(levelByTable.values(), (v) => v), 0);
  tableNames.forEach((name, index) => {
    if (!levelByTable.has(name)) {
      levelByTable.set(name, maxKnownLevel + 1 + index);
    }
  });

  // Keep dependency order, then spread in a landscape grid in the caller.
  return [...tables].sort((a, b) => {
    const levelDiff = (levelByTable.get(a.name) ?? 0) - (levelByTable.get(b.name) ?? 0);
    if (levelDiff !== 0) return levelDiff;

    const outDiff =
      (outgoing.get(b.name)?.size ?? 0) - (outgoing.get(a.name)?.size ?? 0);
    if (outDiff !== 0) return outDiff;

    return a.name.localeCompare(b.name);
  });
};

const buildLandscapePositions = (tables: SchemaTable[]) => {
  const newPositions: Record<string, { x: number; y: number }> = {};
  const orderedTables = buildRelationLayout(tables);
  const totalTables = orderedTables.length;
  const columns = Math.max(
    2,
    Math.ceil(Math.sqrt(totalTables * LANDSCAPE_ASPECT_RATIO)),
  );
  const rows = Math.ceil(totalTables / columns);
  const rowHeights = Array.from({ length: rows }, () => 0);

  orderedTables.forEach((table, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row], getTableHeight(table));
  });

  const rowOffsets = Array.from({ length: rows }, () => 0);
  let nextRowY = CANVAS_MARGIN;
  rowHeights.forEach((height, row) => {
    rowOffsets[row] = nextRowY;
    nextRowY += height + TABLE_ROW_GAP;
  });

  orderedTables.forEach((table, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    newPositions[table.name] = {
      x: CANVAS_MARGIN + col * (TABLE_WIDTH + TABLE_COLUMN_GAP),
      y: rowOffsets[row],
    };
  });

  return newPositions;
};

const CanvasView: React.FC<CanvasViewProps> = ({
  tables,
  layoutVersion,
  canvasState,
  onCanvasStateChange,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastAppliedLayoutVersionRef = useRef(
    Math.max(layoutVersion, persistedLayoutVersion),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [tablePositions, setTablePositions] = useState<
    Record<string, { x: number; y: number }>
  >(persistedTablePositions);
  const canvasStateRef = useRef(canvasState);

  // Keep table positions on auto-refresh; relayout only when requested.
  useEffect(() => {
    setTablePositions((previousPositions) => {
      if (tables.length === 0) return {};

      const shouldRelayout = layoutVersion !== lastAppliedLayoutVersionRef.current;
      if (shouldRelayout || Object.keys(previousPositions).length === 0) {
        lastAppliedLayoutVersionRef.current = layoutVersion;
        return buildLandscapePositions(tables);
      }

      const nextPositions: Record<string, { x: number; y: number }> = {};
      tables.forEach((table) => {
        if (previousPositions[table.name]) {
          nextPositions[table.name] = previousPositions[table.name];
        }
      });

      const missingTables = tables.filter((table) => !nextPositions[table.name]);
      if (missingTables.length > 0) {
        const autoPositions = buildLandscapePositions(tables);
        missingTables.forEach((table) => {
          nextPositions[table.name] = autoPositions[table.name];
        });
      }

      return nextPositions;
    });
  }, [tables, layoutVersion]);

  useEffect(() => {
    persistedTablePositions = tablePositions;
  }, [tablePositions]);

  useEffect(() => {
    persistedLayoutVersion = Math.max(persistedLayoutVersion, layoutVersion);
  }, [layoutVersion]);

  useEffect(() => {
    canvasStateRef.current = canvasState;
  }, [canvasState]);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.target === canvasRef.current) {
      setIsDragging(true);
      setDragStart({
        x: event.clientX - canvasState.position.x,
        y: event.clientY - canvasState.position.y,
      });
    }
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (isDragging) {
      const newX = event.clientX - dragStart.x;
      const newY = event.clientY - dragStart.y;

      onCanvasStateChange({
        ...canvasState,
        position: { x: newX, y: newY },
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const handleWheelEvent = (event: WheelEvent) => {
      event.preventDefault();

      const currentCanvasState = canvasStateRef.current;
      const rect = canvasElement.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      const zoomDirection = event.deltaY < 0 ? 1 : -1;
      const nextZoom = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, currentCanvasState.zoom + zoomDirection * ZOOM_STEP),
      );

      if (nextZoom === currentCanvasState.zoom) return;

      // Keep the world point under cursor stable while zooming.
      const worldX =
        (pointerX - currentCanvasState.position.x) / currentCanvasState.zoom;
      const worldY =
        (pointerY - currentCanvasState.position.y) / currentCanvasState.zoom;
      const nextPosition = {
        x: pointerX - worldX * nextZoom,
        y: pointerY - worldY * nextZoom,
      };

      onCanvasStateChange({
        ...currentCanvasState,
        zoom: nextZoom,
        position: nextPosition,
      });
    };

    canvasElement.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => {
      canvasElement.removeEventListener('wheel', handleWheelEvent);
    };
  }, [onCanvasStateChange]);

  const handleTableDragStart = (event: React.MouseEvent, tableName: string) => {
    event.preventDefault();
    event.stopPropagation();
    const { clientX, clientY } = event;
    const { x, y } = tablePositions[tableName];
    const originalUserSelect = document.body.style.userSelect;

    const startX = clientX - x;
    const startY = clientY - y;

    document.body.style.userSelect = 'none';

    const handleTableDragMove = (moveEvent: MouseEvent) => {
      const newX = moveEvent.clientX - startX;
      const newY = moveEvent.clientY - startY;

      setTablePositions((prev) => ({
        ...prev,
        [tableName]: { x: newX, y: newY },
      }));
    };

    const handleTableDragEnd = () => {
      document.removeEventListener('mousemove', handleTableDragMove);
      document.removeEventListener('mouseup', handleTableDragEnd);
      document.body.style.userSelect = originalUserSelect;
    };

    document.addEventListener('mousemove', handleTableDragMove);
    document.addEventListener('mouseup', handleTableDragEnd);
  };

  const drawRelations = () => {
    // Find relationships between tables
    const relations: Array<{
      from: { table: string; column: string };
      to: { table: string; column: string };
    }> = [];

    tables.forEach((table) => {
      table.columns.forEach((column) => {
        if (column.isForeign && column.references) {
          relations.push({
            from: { table: table.name, column: column.name },
            to: { table: column.references, column: 'id' }, // Assuming reference is to primary key
          });
        }
      });
    });

    return relations.map((relation, index) => {
      const fromTable = tables.find((t) => t.name === relation.from.table);
      const toTable = tables.find((t) => t.name === relation.to.table);

      if (!fromTable || !toTable) return null;

      const fromPos = tablePositions[relation.from.table];
      const toPos = tablePositions[relation.to.table];

      if (!fromPos || !toPos) return null;

      // Find the position of the specific column in the from table
      const fromColumnIndex = fromTable.columns.findIndex(
        (c) => c.name === relation.from.column,
      );
      const toColumnIndex = toTable.columns.findIndex(
        (c) => c.name === relation.to.column,
      );

      const fromY = getColumnY(fromPos.y, fromColumnIndex);
      const toY = getColumnY(toPos.y, toColumnIndex);

      const anchorCandidates = [
        { fromX: fromPos.x, toX: toPos.x, key: 'left-left' },
        { fromX: fromPos.x, toX: toPos.x + TABLE_WIDTH, key: 'left-right' },
        { fromX: fromPos.x + TABLE_WIDTH, toX: toPos.x, key: 'right-left' },
        {
          fromX: fromPos.x + TABLE_WIDTH,
          toX: toPos.x + TABLE_WIDTH,
          key: 'right-right',
        },
      ];

      const tablesOverlapHorizontally =
        fromPos.x < toPos.x + TABLE_WIDTH && toPos.x < fromPos.x + TABLE_WIDTH;

      type AnchorCandidate = (typeof anchorCandidates)[number];
      type ScoredAnchor = AnchorCandidate & { score: number };

      const bestAnchor = anchorCandidates.reduce<ScoredAnchor | null>(
        (best, candidate) => {
        const horizontalDistance = Math.abs(candidate.toX - candidate.fromX);
        const verticalDistance = Math.abs(toY - fromY);
        const sameSide =
          candidate.key === 'left-left' || candidate.key === 'right-right';

        // Prefer shorter paths; when tables overlap horizontally, same-side
        // anchors often keep arrows outside and reduce hidden segments.
        const overlapPenalty =
          tablesOverlapHorizontally && !sameSide ? TABLE_WIDTH * 0.75 : 0;
        const score = horizontalDistance + verticalDistance * 0.6 + overlapPenalty;

          if (!best || score < best.score) {
          return { ...candidate, score };
          }
          return best;
        },
        null,
      );

      if (!bestAnchor) return null;

      const fromX = bestAnchor.fromX;
      const toX = bestAnchor.toX;

      // Draw a path for the relation
      const fromSide = fromX === fromPos.x ? 'left' : 'right';
      const toSide = toX === toPos.x ? 'left' : 'right';
      const horizontalDistance = Math.abs(toX - fromX);
      const curveStrength = Math.max(45, horizontalDistance * 0.35);
      const fromDirection = fromSide === 'left' ? -1 : 1;
      const toDirection = toSide === 'left' ? -1 : 1;

      const path = `M ${fromX} ${fromY} C ${
        fromX + fromDirection * curveStrength
      } ${fromY}, ${toX + toDirection * curveStrength} ${toY}, ${toX} ${toY}`;

      return (
        <path
          key={index}
          d={path}
          stroke="#7c3aed"
          strokeWidth="1.8"
          fill="none"
          markerEnd="url(#arrowhead)"
        />
      );
    });
  };

  const zoomTransform = `scale(${canvasState.zoom})`;

  return (
    <div className="h-full w-full overflow-hidden bg-canvas-bg canvas-grid relative">
      <div
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-grab"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          touchAction: 'none',
        }}
      >
        <div
          className="transform-gpu transition-transform duration-100"
          style={{
            transform: `translate(${canvasState.position.x}px, ${canvasState.position.y}px) ${zoomTransform}`,
            transformOrigin: 'top left',
          }}
        >
          <svg className="absolute top-0 left-0 w-[8000px] h-[8000px] pointer-events-none z-0 overflow-visible">
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#7c3aed" />
              </marker>
            </defs>
            {drawRelations()}
          </svg>

          {tables.map((table) => (
            <div
              key={table.name}
              className="absolute bg-white rounded-md shadow-md border w-60 overflow-hidden z-10"
              style={{
                left: tablePositions[table.name]?.x || 0,
                top: tablePositions[table.name]?.y || 0,
              }}
              onMouseDown={(e) => handleTableDragStart(e, table.name)}
            >
              <div className="bg-primary text-primary-foreground px-4 py-2 font-medium cursor-move">
                {table.name}
              </div>
              <div className="p-0">
                {table.columns.map((column) => (
                  <div
                    key={column.name}
                    className={`px-3 py-1.5 text-sm border-b last:border-0 flex justify-between ${
                      column.isPrimary ? 'font-semibold bg-muted/50' : ''
                    } ${column.isForeign ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      {column.isPrimary && (
                        <span className="text-xs bg-amber-100 text-amber-600 px-1 rounded">
                          PK
                        </span>
                      )}
                      {column.isForeign && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-1 rounded">
                          FK
                        </span>
                      )}
                      <span>{column.name}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {column.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CanvasView;
