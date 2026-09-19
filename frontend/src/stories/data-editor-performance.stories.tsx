/* Copyright 2026 Marimo. All rights reserved. */

import type { DataEditorRef } from "@glideapps/glide-data-grid";
import type { Meta, StoryObj } from "@storybook/react-vite";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { GlideDataEditor } from "@/plugins/impl/data-editor/glide-data-editor";
import type { VisibleRowWindow } from "@/plugins/impl/data-editor/wrap-sizing";
import type { FieldTypes } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";

const meta: Meta = {
  title: "Data Editor/Performance",
};

export default meta;
type Story = StoryObj;

function makeRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    category: index % 3 === 0 ? "alpha" : index % 3 === 1 ? "beta" : "gamma",
    description:
      index % 5 === 0
        ? `Row ${index}: a compact value`
        : `Row ${index}: this is a much longer wrapped value intended to stress row-height approximation when a wrapped column is resized deep in a 100k-row dataset. It should remain stable around the captured top row while the resize is active.`,
  }));
}

const COLUMN_FIELDS = new Map([
  ["id", "integer"],
  ["category", "string"],
  ["description", "string"],
] as const);

const ROW_COUNT_OPTIONS = [100_000, 1_000_000, 10_000_000] as const;
const MAX_DEBUG_EVENTS = 30;

interface WrapSizingDebugEvent {
  stage: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

const Harness = ({ initialRowCount }: { initialRowCount: number }) => {
  const editorRef = useRef<DataEditorRef>(null);
  const [rowCount, setRowCount] = useState(initialRowCount);
  const [data, setData] = useState(() => makeRows(initialRowCount));
  const [columnFields, setColumnFields] = useState<FieldTypes>(
    () => new Map(COLUMN_FIELDS),
  );
  const [visibleRowWindow, setVisibleRowWindow] = useState<VisibleRowWindow>({
    start: 0,
    end: 0,
  });
  const [debugEvents, setDebugEvents] = useState<WrapSizingDebugEvent[]>([]);

  const edits = useMemo(() => [], []);

  React.useEffect(() => {
    setData(makeRows(rowCount));
    setColumnFields(new Map(COLUMN_FIELDS));
    setDebugEvents([]);
  }, [rowCount]);

  const scrollToRow = useCallback((row: number) => {
    editorRef.current?.scrollTo(0, row, "vertical", 0, 0, {
      vAlign: "start",
    });
  }, []);

  const handleWrapSizingDebugEvent = useCallback(
    (event: WrapSizingDebugEvent) => {
      setDebugEvents((prev) => [...prev, event].slice(-MAX_DEBUG_EVENTS));
    },
    [],
  );

  const latestAnchorRow =
    [...debugEvents]
      .reverse()
      .find((event) => typeof event.payload.anchorRow === "number")?.payload
      .anchorRow ?? null;

  return (
    <div className="m-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ROW_COUNT_OPTIONS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={rowCount === option ? "default" : "outline"}
            onClick={() => setRowCount(option)}
          >
            {option.toLocaleString()} rows
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => scrollToRow(80_000)}
        >
          Scroll to row 80k
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => scrollToRow(90_000)}
        >
          Scroll to row 90k
        </Button>
        <div className="text-sm text-muted-foreground">
          Visible rows: {visibleRowWindow.start} - {visibleRowWindow.end}
        </div>
        <div className="text-sm text-muted-foreground">
          Anchor row: {latestAnchorRow ?? "-"}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="max-w-5xl">
          <GlideDataEditor
            data={data}
            setData={setData}
            columnFields={columnFields}
            setColumnFields={setColumnFields}
            editableColumns="all"
            edits={edits}
            onAddEdits={() => undefined}
            onAddRows={() => undefined}
            onDeleteRows={() => undefined}
            onRenameColumn={() => undefined}
            onDeleteColumn={() => undefined}
            onAddColumn={() => undefined}
            wrappedColumns={["description"]}
            wrappedRowHeightStrategy="approxIncrementalRough"
            enableWrapSizingDebug={true}
            onWrapSizingDebugEvent={handleWrapSizingDebugEvent}
            editorRef={editorRef}
            onVisibleRowWindowChange={setVisibleRowWindow}
          />
        </div>

        <div className="rounded-md border bg-muted/20 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-medium">Wrap Sizing Debug</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDebugEvents([])}
            >
              Clear logs
            </Button>
          </div>
          <div className="mb-3 space-y-1 text-muted-foreground">
            <div>Latest anchor row: {latestAnchorRow ?? "-"}</div>
            <div>
              Latest visible window: {visibleRowWindow.start} - {visibleRowWindow.end}
            </div>
            <div>Events buffered: {debugEvents.length}</div>
          </div>
          <div className="max-h-[520px] overflow-auto rounded border bg-background p-2 font-mono">
            {debugEvents.length === 0 ? (
              <div className="text-muted-foreground">No events yet</div>
            ) : (
              debugEvents
                .toReversed()
                .map((event, index) => (
                  <div key={`${event.timestamp}-${index}`} className="mb-3 border-b pb-2 last:mb-0 last:border-b-0">
                    <div className="font-semibold">{event.stage}</div>
                    <div className="text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</div>
                    <pre className="mt-1 whitespace-pre-wrap break-words">{JSON.stringify(event.payload, null, 2)}</pre>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ApproximateIncrementalRough100k: Story = {
  render: () => <Harness initialRowCount={100_000} />,
};
