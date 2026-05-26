/* Copyright 2026 Marimo. All rights reserved. */

import { useMemo, useState } from "react";
import type { FieldTypes } from "@/components/data-table/types";
import { GlideDataEditor } from "@/plugins/impl/data-editor/glide-data-editor";
import type { WrappedRowHeightStrategy } from "@/plugins/impl/data-editor/wrap-sizing";

export default {
  title: "DataEditor/ResizeComparison",
};

type Row = {
  id: number;
  title: string;
  notes: string;
  status: string;
};

const RESIZE_TARGET_LEFT = 600;

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Row ${index + 1}`,
    notes:
      index % 4 === 0
        ? "Short note."
        : index % 4 === 1
          ? "This is a much longer note intended to wrap across multiple lines so the live resize behavior is obvious while dragging the notes column narrower or wider."
          : index % 4 === 2
            ? "IDs: alpha-001, beta-002, gamma-003; owners: ops@example.com, qa@example.com, infra@example.com."
            : "Tokyo rail updates 東京駅から新宿駅まで quickly-change status labels and compare word segmentation behavior.",
    status: index % 2 === 0 ? "ok" : "needs review",
  }));
}

function ResizePanel({
  label,
  strategy,
  panelTestId,
  dragTargetTestId,
}: {
  label: string;
  strategy: WrappedRowHeightStrategy;
  panelTestId: string;
  dragTargetTestId: string;
}) {
  const [data, setData] = useState(() => makeRows(400));
  const [columnFields, setColumnFields] = useState(
    (): FieldTypes =>
      new Map([
        ["id", "integer"],
        ["title", "string"],
        ["notes", "string"],
        ["status", "string"],
      ]),
  );

  return (
    <div
      className="relative rounded-md border bg-background p-3"
      data-testid={panelTestId}
    >
      <div className="mb-2">
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">
          Drag the invisible target above the `notes` resizer. This uses the
          real underlying grid drag path.
        </div>
      </div>
      <div
        data-testid={dragTargetTestId}
        aria-hidden="true"
        className="pointer-events-none absolute top-11 z-10 h-8 w-3 rounded-sm border border-dashed border-violet-400/70 bg-violet-400/10"
        style={{ left: RESIZE_TARGET_LEFT }}
      />
      <GlideDataEditor
        data={data}
        setData={setData}
        columnFields={columnFields}
        setColumnFields={setColumnFields}
        editableColumns="all"
        wrappedColumns={["notes"]}
        wrappedRowHeightStrategy={strategy}
        edits={[]}
        onAddEdits={() => undefined}
        onAddRows={() => undefined}
        onDeleteRows={() => undefined}
        onRenameColumn={() => undefined}
        onDeleteColumn={() => undefined}
        onAddColumn={() => undefined}
      />
    </div>
  );
}

export const ApproxVsIncrementalResize = {
  render: () => {
    const labels = useMemo(
      () => [
        {
          label: "Approximate dynamic",
          strategy: "approx" as const,
          panelTestId: "approx-panel",
          dragTargetTestId: "approx-notes-resize-target",
        },
        {
          label: "Approximate incremental",
          strategy: "approxIncremental" as const,
          panelTestId: "approx-incremental-panel",
          dragTargetTestId: "approx-incremental-notes-resize-target",
        },
        {
          label: "Approximate incremental (baseline)",
          strategy: "approxIncrementalBaseline" as const,
          panelTestId: "approx-incremental-baseline-panel",
          dragTargetTestId: "approx-incremental-baseline-notes-resize-target",
        },
      ],
      [],
    );

    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Side-by-side resize comparison for `approx`, viewport-anchored
          `approxIncremental`, and non-anchored `approxIncrementalBaseline`. The
          dashed marker above each grid is a stable coordinate anchor for
          Playwright; the script drags at that position so the real `notes`
          column resizer is exercised underneath.
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {labels.map((panel) => (
            <ResizePanel key={panel.panelTestId} {...panel} />
          ))}
        </div>
      </div>
    );
  },
};
