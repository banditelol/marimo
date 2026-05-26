/* Copyright 2026 Marimo. All rights reserved. */

import DataEditor, {
  CompactSelection,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  GridCellKind,
  type GridColumn,
  GridColumnIcon,
  type GridKeyEventArgs,
  type GridSelection,
  type Item,
  type Rectangle,
} from "@glideapps/glide-data-grid";
import { CopyIcon, TrashIcon, WrapTextIcon } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useEvent from "react-use-event-hook";
import type { FieldTypes } from "@/components/data-table/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/theme/useTheme";
import { copyToClipboard } from "@/utils/copy";
import { dequal as isEqual } from "dequal";
import {
  getColumnHeaderIcon,
  getColumnKind,
  isColumnEdit,
  isPositionalEdit,
  isRowEdit,
  pasteCells,
} from "./glide-utils";
import { getGlideTheme, getGlideWrapThemeMetrics } from "./themes";
import { BulkEdit, type Edits, type ModifiedGridColumn } from "./types";
import "@glideapps/glide-data-grid/dist/index.css"; // TODO: We are reimporting this
import { ErrorBoundary } from "@/components/editor/boundary/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import type { DataType } from "@/core/kernel/messages";
import { useInternalStateWithSync } from "@/hooks/useInternalStateWithSync";
import { useNonce } from "@/hooks/useNonce";
import { logNever } from "@/utils/assertNever";
import { Events } from "@/utils/events";
import { AddColumnSub, RenameColumnSub } from "./components";
import {
  insertColumn,
  modifyColumnFields,
  removeColumn,
  renameColumn,
} from "./data-utils";
import {
  DEFAULT_ROW_HEIGHT,
  estimateWrappedRowHeights,
  estimateWrappedRowHeightsInRange,
  FIXED_WRAPPED_ROW_HEIGHT,
  getWrappedColumnWidth,
  type WrappedRowHeightStrategy,
} from "./wrap-sizing";

interface GlideDataEditorProps<T> {
  data: T[];
  setData: (data: T[] | ((prev: T[]) => T[])) => void;
  columnFields: FieldTypes;
  setColumnFields: React.Dispatch<React.SetStateAction<FieldTypes>>;
  editableColumns: string[] | "all";
  wrappedColumns?: string[];
  wrappedRowHeightStrategy?: WrappedRowHeightStrategy;
  edits: Edits["edits"];
  onAddEdits: (edits: Edits["edits"]) => void;
  onAddRows: (newRows: object[]) => void;
  onDeleteRows: (rows: number[]) => void;
  onRenameColumn: (columnIdx: number, newName: string) => void;
  onDeleteColumn: (columnIdx: number) => void;
  onAddColumn: (columnIdx: number, newName: string) => void;
}

interface ResizeAnchorSession {
  id: number;
  anchorRow: number;
  phase: "resizing" | "settling";
  correctionApplied: boolean;
}

export const GlideDataEditor = <T,>({
  data,
  setData,
  columnFields,
  setColumnFields,
  editableColumns,
  wrappedColumns,
  wrappedRowHeightStrategy = "measureText",
  edits,
  onAddEdits,
  onAddRows,
  onDeleteRows,
  onRenameColumn,
  onDeleteColumn,
  onAddColumn,
}: GlideDataEditorProps<T>) => {
  const { theme } = useTheme();
  const dataEditorRef = useRef<DataEditorRef>(null);

  const [menu, setMenu] = useState<{ col: number; bounds: Rectangle }>();
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [selection, setSelection] = React.useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [settledColumnWidths, setSettledColumnWidths] = useState<
    Record<string, number>
  >({});
  const [wrappedColumnState, setWrappedColumnState] = useInternalStateWithSync<
    string[]
  >(wrappedColumns ?? [], isEqual);
  const [fitHeightColumns, setFitHeightColumns] = useState<string[]>([]);
  const [fittedRowHeights, setFittedRowHeights] = useState<
    number[] | undefined
  >();
  const [incrementalRowHeights, setIncrementalRowHeights] = useState<
    number[] | undefined
  >();
  const [isIncrementalResizeActive, setIsIncrementalResizeActive] =
    useState(false);
  const [visibleRowWindow, setVisibleRowWindow] = useState({ y: 0, height: 0 });
  const rerender = useNonce();
  const hasAppliedEdits = useRef(false);
  const resizeCommitTimeoutRef = useRef<number | null>(null);
  const pendingResizeWidthsRef = useRef<Record<string, number>>({});
  const isColumnResizeActiveRef = useRef(false);
  const incrementalComputationVersionRef = useRef(0);
  const resizeAnchorSessionRef = useRef<ResizeAnchorSession | null>(null);
  const nextResizeAnchorSessionIdRef = useRef(0);
  const isIncrementalResizeActiveRef = useRef(false);
  const visibleRowWindowRef = useRef({ y: 0, height: 0 });

  const wrappedColumnsSet = useMemo(
    () => new Set(wrappedColumnState),
    [wrappedColumnState],
  );

  const columnDataTypes = useMemo(() => new Map(columnFields), [columnFields]);

  const wrapThemeMetrics = useMemo(
    () => getGlideWrapThemeMetrics(theme),
    [theme],
  );
  const visibleRowEstimate =
    data.length > 10
      ? Math.max(1, Math.ceil(450 / DEFAULT_ROW_HEIGHT))
      : Math.max(1, data.length);
  const incrementalBatchSize = Math.max(100, visibleRowEstimate * 2);

  const computeFittedRowHeights = useCallback(
    (columnsToFit: string[]) => {
      if (wrappedRowHeightStrategy !== "fixed" || columnsToFit.length === 0) {
        return undefined;
      }

      return estimateWrappedRowHeights({
        data,
        wrappedColumns: new Set(columnsToFit),
        columnWidths,
        columnDataTypes,
        strategy: "approx",
        themeMetrics: wrapThemeMetrics,
      });
    },
    [
      columnDataTypes,
      columnWidths,
      data,
      wrapThemeMetrics,
      wrappedRowHeightStrategy,
    ],
  );

  const columns: ModifiedGridColumn[] = useMemo(() => {
    const columns: ModifiedGridColumn[] = [];
    for (const [columnName, fieldType] of columnFields) {
      const editable =
        editableColumns === "all" || editableColumns.includes(columnName);

      columns.push({
        id: columnName,
        title: columnName,
        width: wrappedColumnsSet.has(columnName)
          ? getWrappedColumnWidth(columnWidths[columnName])
          : columnWidths[columnName],
        icon: editable
          ? getColumnHeaderIcon(fieldType)
          : GridColumnIcon.ProtectedColumnOverlay,
        style: "normal",
        kind: getColumnKind(fieldType),
        dataType: fieldType,
        hasMenu: true,
        themeOverride: editable
          ? undefined
          : {
              bgCell: theme === "light" ? "#F9F9FA" : "#1e1e21",
            },
      });
    }

    return columns;
  }, [columnFields, columnWidths, editableColumns, theme, wrappedColumnsSet]);

  const rowHeights = useMemo(() => {
    if (wrappedRowHeightStrategy === "fixed") {
      return (
        fittedRowHeights ??
        (wrappedColumnState.length > 0 ? FIXED_WRAPPED_ROW_HEIGHT : undefined)
      );
    }

    if (
      wrappedRowHeightStrategy === "approxIncremental" ||
      wrappedRowHeightStrategy === "approxIncrementalBaseline"
    ) {
      return incrementalRowHeights;
    }

    return estimateWrappedRowHeights({
      data,
      wrappedColumns: wrappedColumnsSet,
      columnWidths:
        wrappedRowHeightStrategy === "approxDeferred"
          ? settledColumnWidths
          : columnWidths,
      columnDataTypes,
      strategy: wrappedRowHeightStrategy,
      themeMetrics: wrapThemeMetrics,
    });
  }, [
    columnDataTypes,
    columnWidths,
    data,
    fittedRowHeights,
    incrementalRowHeights,
    settledColumnWidths,
    wrapThemeMetrics,
    wrappedColumnState.length,
    wrappedColumnsSet,
    wrappedRowHeightStrategy,
  ]);

  const onVisibleRegionChanged = useCallback((region: Rectangle) => {
    visibleRowWindowRef.current = { y: region.y, height: region.height };
    setVisibleRowWindow((prev) => {
      if (prev.y === region.y && prev.height === region.height) {
        return prev;
      }
      return { y: region.y, height: region.height };
    });
  }, []);

  const startResizeAnchorSession = useCallback(() => {
    const currentSession = resizeAnchorSessionRef.current;
    if (currentSession?.phase === "resizing") {
      return currentSession;
    }

    const anchorRow = Math.min(
      Math.max(0, visibleRowWindowRef.current.y),
      Math.max(0, data.length - 1),
    );
    const nextSession: ResizeAnchorSession = {
      id: nextResizeAnchorSessionIdRef.current + 1,
      anchorRow,
      phase: "resizing",
      correctionApplied: false,
    };

    nextResizeAnchorSessionIdRef.current = nextSession.id;
    resizeAnchorSessionRef.current = nextSession;
    return nextSession;
  }, [data.length]);

  const finishIncrementalResizeSession = useCallback(() => {
    isIncrementalResizeActiveRef.current = false;
    setIsIncrementalResizeActive(false);

    const currentSession = resizeAnchorSessionRef.current;
    if (currentSession?.phase === "resizing") {
      resizeAnchorSessionRef.current = {
        ...currentSession,
        phase: "settling",
      };
    }
  }, []);

  const interruptSettlingResizeAnchor = useCallback(() => {
    const currentSession = resizeAnchorSessionRef.current;
    if (
      currentSession?.phase === "settling" &&
      !currentSession.correctionApplied
    ) {
      resizeAnchorSessionRef.current = null;
    }
  }, []);

  const scrollResizeAnchorIntoView = useCallback(
    (sessionId: number, row: number) => {
      window.requestAnimationFrame(() => {
        const currentSession = resizeAnchorSessionRef.current;
        if (
          !currentSession ||
          currentSession.id !== sessionId ||
          currentSession.phase !== "settling" ||
          currentSession.correctionApplied
        ) {
          return;
        }

        resizeAnchorSessionRef.current = {
          ...currentSession,
          correctionApplied: true,
        };
        dataEditorRef.current?.scrollTo(0, row, "vertical", 0, 0, {
          vAlign: "start",
        });
        if (resizeAnchorSessionRef.current?.id === sessionId) {
          resizeAnchorSessionRef.current = null;
        }
      });
    },
    [],
  );

  useEffect(() => {
    if (
      wrappedRowHeightStrategy !== "approxIncremental" &&
      wrappedRowHeightStrategy !== "approxIncrementalBaseline"
    ) {
      setIncrementalRowHeights(undefined);
      resizeAnchorSessionRef.current = null;
      return;
    }

    incrementalComputationVersionRef.current += 1;
    const computationVersion = incrementalComputationVersionRef.current;

    if (wrappedColumnsSet.size === 0 || data.length === 0) {
      setIncrementalRowHeights(undefined);
      resizeAnchorSessionRef.current = null;
      return;
    }

    let cancelled = false;
    setIncrementalRowHeights((prev) => {
      if (!prev || prev.length !== data.length) {
        return Array.from({ length: data.length }, () => DEFAULT_ROW_HEIGHT);
      }
      return prev;
    });

    const batchRanges: Array<{ start: number; end: number }> = [];

    const activeResizeSession = resizeAnchorSessionRef.current;
    const anchorStart = Math.min(
      Math.max(0, activeResizeSession?.anchorRow ?? visibleRowWindow.y),
      Math.max(0, data.length - 1),
    );
    const anchorEnd = Math.min(data.length, anchorStart + incrementalBatchSize);
    batchRanges.push({ start: anchorStart, end: anchorEnd });

    for (let end = anchorStart; end > 0; end -= incrementalBatchSize) {
      batchRanges.push({
        start: Math.max(0, end - incrementalBatchSize),
        end,
      });
    }

    for (
      let start = anchorEnd;
      start < data.length;
      start += incrementalBatchSize
    ) {
      batchRanges.push({
        start,
        end: Math.min(data.length, start + incrementalBatchSize),
      });
    }

    const runBatch = (batchIndexPosition: number) => {
      if (
        cancelled ||
        computationVersion !== incrementalComputationVersionRef.current
      ) {
        return;
      }

      if (
        batchIndexPosition >= batchRanges.length ||
        (isIncrementalResizeActive && batchIndexPosition > 0)
      ) {
        return;
      }

      const range = batchRanges[batchIndexPosition];
      if (!range) {
        return;
      }

      const batchHeights = estimateWrappedRowHeightsInRange({
        data,
        wrappedColumns: wrappedColumnsSet,
        columnWidths,
        columnDataTypes,
        strategy: "approx",
        themeMetrics: wrapThemeMetrics,
        start: range.start,
        end: range.end,
      });

      if (batchHeights && batchHeights.length > 0) {
        setIncrementalRowHeights((prev) => {
          const next = prev
            ? [...prev]
            : Array.from({ length: data.length }, () => DEFAULT_ROW_HEIGHT);

          for (let index = 0; index < batchHeights.length; index += 1) {
            next[range.start + index] =
              batchHeights[index] ?? DEFAULT_ROW_HEIGHT;
          }
          return next;
        });

        const resizeAnchorSession = resizeAnchorSessionRef.current;
        const hasMeasuredRowsThroughAnchor =
          range.start === 0 ||
          (resizeAnchorSession?.anchorRow === 0 && batchIndexPosition === 0);
        const shouldRestoreResizeAnchor =
          wrappedRowHeightStrategy === "approxIncremental" &&
          resizeAnchorSession != null &&
          resizeAnchorSession.phase === "settling" &&
          !resizeAnchorSession.correctionApplied &&
          !isIncrementalResizeActive &&
          hasMeasuredRowsThroughAnchor;
        if (shouldRestoreResizeAnchor) {
          scrollResizeAnchorIntoView(
            resizeAnchorSession.id,
            resizeAnchorSession.anchorRow,
          );
        }
      }

      window.requestAnimationFrame(() => {
        runBatch(batchIndexPosition + 1);
      });
    };

    window.requestAnimationFrame(() => {
      runBatch(0);
    });

    return () => {
      cancelled = true;
    };
  }, [
    columnDataTypes,
    columnWidths,
    data,
    isIncrementalResizeActive,
    incrementalBatchSize,
    scrollResizeAnchorIntoView,
    visibleRowWindow.height,
    visibleRowWindow.y,
    wrapThemeMetrics,
    wrappedColumnsSet,
    wrappedRowHeightStrategy,
  ]);

  useEffect(() => {
    const commitPendingResizeWidths = () => {
      const wasDeferredResizeActive = isColumnResizeActiveRef.current;
      isColumnResizeActiveRef.current = false;
      finishIncrementalResizeSession();

      if (!wasDeferredResizeActive) {
        return;
      }

      if (resizeCommitTimeoutRef.current != null) {
        window.clearTimeout(resizeCommitTimeoutRef.current);
        resizeCommitTimeoutRef.current = null;
      }

      const pendingEntries = Object.entries(pendingResizeWidthsRef.current);
      if (pendingEntries.length === 0) {
        return;
      }

      setSettledColumnWidths((prev) => ({
        ...prev,
        ...pendingResizeWidthsRef.current,
      }));
      pendingResizeWidthsRef.current = {};
    };

    const handlePointerRelease = () => {
      if (
        wrappedRowHeightStrategy !== "approxDeferred" &&
        wrappedRowHeightStrategy !== "approxIncremental" &&
        wrappedRowHeightStrategy !== "approxIncrementalBaseline"
      ) {
        return;
      }
      commitPendingResizeWidths();
    };

    window.addEventListener("pointerup", handlePointerRelease);
    window.addEventListener("mouseup", handlePointerRelease);

    return () => {
      window.removeEventListener("pointerup", handlePointerRelease);
      window.removeEventListener("mouseup", handlePointerRelease);
      if (resizeCommitTimeoutRef.current != null) {
        window.clearTimeout(resizeCommitTimeoutRef.current);
      }
    };
  }, [finishIncrementalResizeSession, wrappedRowHeightStrategy]);

  // Apply initial edits after data has loaded
  useEffect(() => {
    // Don't apply if already applied or data hasn't loaded yet
    if (hasAppliedEdits.current || data.length === 0) {
      return;
    }

    // Mark as applied once data loads - prevents re-applying user edits
    hasAppliedEdits.current = true;

    // No initial edits to apply
    if (edits.length === 0) {
      return;
    }

    // Group edits by row index to build new rows
    const newRows = new Map<number, Record<string, unknown>>();

    for (const edit of edits) {
      if (isPositionalEdit(edit)) {
        if (edit.rowIdx >= data.length) {
          // This is a new row
          if (!newRows.has(edit.rowIdx)) {
            newRows.set(edit.rowIdx, {});
          }
          const row = newRows.get(edit.rowIdx);
          if (row) {
            row[edit.columnId] = edit.value;
          }
        } else {
          // This is an existing row, update the data
          setData((prev) => {
            const newData = [...prev];
            newData[edit.rowIdx][edit.columnId as keyof T] =
              edit.value as T[keyof T];
            return newData;
          });
        }
      } else if (isRowEdit(edit) && edit.type === BulkEdit.Remove) {
        // Add rows is currently handled under positional edits, so we only cover deletes here
        setData((prev) => prev.filter((_, i) => i !== edit.rowIdx));
      } else if (isColumnEdit(edit)) {
        switch (edit.type) {
          case BulkEdit.Remove:
            // Remove the column from the data
            setData((prev) => removeColumn(prev, edit.columnIdx));
            setColumnFields((prev) =>
              modifyColumnFields({
                columnFields: prev,
                columnIdx: edit.columnIdx,
                type: "remove",
              }),
            );
            break;
          case BulkEdit.Insert:
            setColumnFields((prev) =>
              modifyColumnFields({
                columnFields: prev,
                columnIdx: edit.columnIdx,
                type: "insert",
                newColumnName: edit.newName,
              }),
            );
            setData((prev) => insertColumn(prev, edit.newName));
            break;
          case BulkEdit.Rename: {
            const oldName = columns[edit.columnIdx].title;
            const newName = edit.newName;
            if (!oldName || !newName) {
              return;
            }

            setColumnFields((prev) =>
              modifyColumnFields({
                columnFields: prev,
                columnIdx: edit.columnIdx,
                type: "rename",
                newColumnName: newName,
              }),
            );

            setData((prev) => renameColumn(prev, oldName, newName));
            break;
          }
        }
      }
    }

    // Add new rows in order
    const sortedNewRows = [...newRows.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([, row]) => row);

    if (sortedNewRows.length > 0) {
      setData((prev) => [...prev, ...(sortedNewRows as T[])]);
    }

    // Force re-render to update the total rows
    rerender();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length]);

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      const dataRow = data[row];

      const dataItem = dataRow[columns[col].title as keyof T];
      const columnKind = columns[col].kind;
      const columnTitle = columns[col].title;
      const editable =
        editableColumns === "all" || editableColumns.includes(columnTitle);
      const wrapped = wrappedColumnsSet.has(columnTitle);

      if (columnKind === GridCellKind.Boolean) {
        const value = Boolean(dataItem);
        return {
          kind: GridCellKind.Boolean,
          allowOverlay: false,
          readonly: !editable,
          data: value,
        };
      }

      if (columnKind === GridCellKind.Number && typeof dataItem === "number") {
        return {
          kind: GridCellKind.Number,
          allowOverlay: editable,
          readonly: !editable,
          displayData: String(dataItem),
          data: dataItem,
        };
      }

      return {
        kind: GridCellKind.Text,
        allowOverlay: editable,
        allowWrapping: wrapped,
        readonly: !editable,
        displayData: String(dataItem),
        data: String(dataItem),
      };
    },
    [columns, data, editableColumns, wrappedColumnsSet],
  );

  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [col, row] = cell;
      const column = columns[col];
      const key = column.title;

      // Deletes are not handled by validateCell, so we need to handle them here
      let newData = newValue.data;
      if (
        (column.dataType === "number" || column.dataType === "integer") &&
        (newValue.data === undefined || newValue.data === "")
      ) {
        newData = null;
      }

      setData((prev) => {
        const data = [...prev];
        data[row][key as keyof T] = newData as T[keyof T];
        return data;
      });

      onAddEdits([{ rowIdx: row, columnId: key, value: newData }]);
    },
    [columns, onAddEdits, setData],
  );

  const onColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      const nextSize = wrappedColumnsSet.has(column.title)
        ? getWrappedColumnWidth(newSize)
        : newSize;

      setColumnWidths((prev) => ({
        ...prev,
        [column.title]: nextSize,
      }));

      if (wrappedRowHeightStrategy === "approxDeferred") {
        isColumnResizeActiveRef.current = true;
        pendingResizeWidthsRef.current = {
          ...pendingResizeWidthsRef.current,
          [column.title]: nextSize,
        };

        if (resizeCommitTimeoutRef.current != null) {
          window.clearTimeout(resizeCommitTimeoutRef.current);
        }

        resizeCommitTimeoutRef.current = window.setTimeout(() => {
          isColumnResizeActiveRef.current = false;
          setSettledColumnWidths((prev) => ({
            ...prev,
            ...pendingResizeWidthsRef.current,
          }));
          pendingResizeWidthsRef.current = {};
          resizeCommitTimeoutRef.current = null;
        }, 400);
        return;
      }

      if (wrappedRowHeightStrategy === "approxIncremental") {
        startResizeAnchorSession();
        isIncrementalResizeActiveRef.current = true;
        setIsIncrementalResizeActive(true);

        if (resizeCommitTimeoutRef.current != null) {
          window.clearTimeout(resizeCommitTimeoutRef.current);
        }

        resizeCommitTimeoutRef.current = window.setTimeout(() => {
          finishIncrementalResizeSession();
          resizeCommitTimeoutRef.current = null;
        }, 400);
        return;
      }

      if (wrappedRowHeightStrategy === "approxIncrementalBaseline") {
        isIncrementalResizeActiveRef.current = true;
        setIsIncrementalResizeActive(true);

        if (resizeCommitTimeoutRef.current != null) {
          window.clearTimeout(resizeCommitTimeoutRef.current);
        }

        resizeCommitTimeoutRef.current = window.setTimeout(() => {
          finishIncrementalResizeSession();
          resizeCommitTimeoutRef.current = null;
        }, 400);
        return;
      }

      setSettledColumnWidths((prev) => ({
        ...prev,
        [column.title]: nextSize,
      }));
    },
    [
      finishIncrementalResizeSession,
      startResizeAnchorSession,
      wrappedColumnsSet,
      wrappedRowHeightStrategy,
    ],
  );

  // Only called when user edits a cell, not deletes
  const validateCell = useCallback(
    (cell: Item, newValue: EditableGridCell, _prevValue: GridCell): boolean => {
      const [col, _row] = cell;
      const key = columns[col].title;

      const columnType = columnFields.get(key);
      // Verify the new value is of the correct type
      switch (columnType) {
        case "number":
        case "integer":
          if (Number.isNaN(Number(newValue.data))) {
            return false;
          }
          break;
        case "boolean":
          if (typeof newValue.data !== "boolean") {
            return false;
          }
          break;
      }

      return true;
    },
    [columnFields, columns],
  );

  // Hack to emit copy event as these events aren't triggered automatically in shadow DOM
  // Paste event does not work so we manually handle it
  const onKeyDown = useCallback(
    (e: GridKeyEventArgs) => {
      if (!dataEditorRef.current) {
        return;
      }

      if (Events.isMetaOrCtrl(e) && e.key === "c") {
        dataEditorRef.current.emit("copy");
        return;
      }

      if (Events.isMetaOrCtrl(e) && e.key === "v") {
        pasteCells({
          selection,
          data,
          setData,
          columns,
          editableColumns,
          onAddEdits,
        });
        return;
      }

      if (Events.isMetaOrCtrl(e) && e.key === "f") {
        setShowSearch((prev) => !prev);
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      if (e.key === "Escape") {
        setShowSearch(false);
        return;
      }
    },
    [columns, data, editableColumns, onAddEdits, selection, setData],
  );

  const onRowAppend = useCallback(() => {
    const newRow: Record<string, unknown> = Object.fromEntries(
      columns.map((column) => {
        const dataType = column.dataType;
        switch (dataType) {
          case "boolean":
            return [column.title, false];
          case "number":
          case "integer":
            return [column.title, null];
          case "date":
          case "datetime":
          case "time":
            // TODO: Handle specific types
            return [column.title, new Date()];
          case "string":
          case "unknown":
            return [column.title, ""];
          default:
            logNever(dataType);
            return [column.title, ""];
        }
      }),
    );
    onAddRows([newRow]);

    // Update data
    setData((prev) => [...prev, newRow as T]);
  }, [columns, onAddRows, setData]);

  const handleDeleteRows = () => {
    const rows = selection.rows.toArray();
    onDeleteRows(rows);

    let index = 0;
    for (const row of rows) {
      const adjustedRow = row - index; // Adjust for previously deleted rows
      setData((prev) => prev.filter((_, i) => i !== adjustedRow));
      index++;
    }

    // Clear selection
    setSelection({
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty(),
    });
  };

  const onHeaderMenuClick = useEvent((col: number, bounds: Rectangle) => {
    setMenu({ col, bounds });
  });

  const handleCopyColumnName = async () => {
    if (menu) {
      const columnName = columns[menu.col].title;
      await copyToClipboard(columnName);
      setMenu(undefined);
    }
  };

  const handleToggleWrapColumn = () => {
    if (!menu) {
      return;
    }

    const columnName = columns[menu.col].title;
    setWrappedColumnState((prev) => {
      const nextWrappedColumns = prev.includes(columnName)
        ? prev.filter((name) => name !== columnName)
        : [...prev, columnName];

      if (wrappedRowHeightStrategy === "fixed") {
        const nextFitHeightColumns = fitHeightColumns.filter((name) =>
          nextWrappedColumns.includes(name),
        );
        setFitHeightColumns(nextFitHeightColumns);
        setFittedRowHeights(computeFittedRowHeights(nextFitHeightColumns));
      }

      return nextWrappedColumns;
    });
    setMenu(undefined);
  };

  const handleFitHeightToText = () => {
    if (!menu || wrappedRowHeightStrategy !== "fixed") {
      return;
    }

    const columnName = columns[menu.col].title;
    const nextWrappedColumns = wrappedColumnsSet.has(columnName)
      ? wrappedColumnState
      : [...wrappedColumnState, columnName];
    const nextFitHeightColumns = fitHeightColumns.includes(columnName)
      ? fitHeightColumns
      : [...fitHeightColumns, columnName];

    setWrappedColumnState(nextWrappedColumns);
    setFitHeightColumns(nextFitHeightColumns);
    setFittedRowHeights(computeFittedRowHeights(nextFitHeightColumns));
    setMenu(undefined);
  };

  function toastColumnExists(name: string) {
    toast({
      title: `Column '${name}' already exists`,
      description: "Please enter a different column name",
      variant: "danger",
    });
  }

  const handleRenameColumn = (newName: string) => {
    if (menu) {
      const oldColumnName = columns[menu.col].title;

      // Validate the new column name
      if (columnFields.has(newName)) {
        toastColumnExists(newName);
        return;
      }

      const dataType = columns[menu.col].dataType;

      onRenameColumn(menu.col, newName);
      setWrappedColumnState((prev) =>
        prev.includes(oldColumnName)
          ? prev.map((name) => (name === oldColumnName ? newName : name))
          : prev,
      );
      setFitHeightColumns((prev) => {
        const nextFitHeightColumns = prev.includes(oldColumnName)
          ? prev.map((name) => (name === oldColumnName ? newName : name))
          : prev;
        setFittedRowHeights(computeFittedRowHeights(nextFitHeightColumns));
        return nextFitHeightColumns;
      });
      setColumnFields((prev) =>
        modifyColumnFields({
          columnFields: prev,
          columnIdx: menu.col,
          type: "rename",
          dataType,
          newColumnName: newName,
        }),
      );

      // Update the data
      setData((prev) => renameColumn(prev, oldColumnName, newName));
      setMenu(undefined);
    }
  };

  const handleDeleteColumn = () => {
    if (menu) {
      const columnName = columns[menu.col].title;
      onDeleteColumn(menu.col);
      setWrappedColumnState((prev) =>
        prev.filter((name) => name !== columnName),
      );
      setFitHeightColumns((prev) => {
        const nextFitHeightColumns = prev.filter((name) => name !== columnName);
        setFittedRowHeights(computeFittedRowHeights(nextFitHeightColumns));
        return nextFitHeightColumns;
      });
      setColumnFields((prev) =>
        modifyColumnFields({
          columnFields: prev,
          columnIdx: menu.col,
          type: "remove",
        }),
      );

      setData((prev) => removeColumn(prev, menu.col));
      setMenu(undefined);
    }
  };

  const handleAddColumn = (options: {
    direction: "left" | "right";
    columnName: string;
    dataType: DataType;
  }) => {
    const { direction, columnName, dataType } = options;

    if (menu) {
      const columnIdx = menu.col + (direction === "left" ? 0 : 1);
      // Clamp to 0 and length of columns
      const clampedColumnIdx = Math.max(0, Math.min(columnIdx, columns.length));

      // Validate the new column name
      if (columnFields.has(columnName)) {
        toastColumnExists(columnName);
        return;
      }

      onAddColumn(clampedColumnIdx, columnName);

      setColumnFields((prev) =>
        modifyColumnFields({
          columnFields: prev,
          columnIdx: clampedColumnIdx,
          type: "insert",
          dataType,
          newColumnName: columnName,
        }),
      );

      // Update the data - add the new column to all rows,
      // ordering does not matter as we call getCellContent based on columnTitle
      setData((prev) => insertColumn(prev, columnName));
      setMenu(undefined);
    }
  };

  const isLastColumn = menu?.col === columns.length - 1;
  const selectedColumnName = menu ? columns[menu.col].title : undefined;
  const isSelectedColumnFitHeight = selectedColumnName
    ? fitHeightColumns.includes(selectedColumnName)
    : false;

  // There is a guarantee that only one column's menu is open (as interaction is disabled outside of the menu)
  const isMenuOpen = menu !== undefined;
  const iconClassName = "mr-2 h-3.5 w-3.5";

  const trailingRowOptions = {
    hint: "New row",
    sticky: true,
    tint: true,
  };

  const isLargeDataset = data.length > 100_000;

  // For now, only allow renaming and deleting if all columns are editable
  // Users who set specific columns usually will not want to rename or delete columns
  const allowRenameDelete = editableColumns === "all";

  const renderDropdownMenu = () => {
    if (!isMenuOpen) {
      return;
    }

    const bulkEditItems = (
      <>
        {allowRenameDelete && (
          <RenameColumnSub
            currentColumnName={columns[menu.col].title}
            onRename={handleRenameColumn}
            onCancel={() => setMenu(undefined)}
          />
        )}

        <DropdownMenuSeparator />

        <AddColumnSub
          direction="left"
          onAdd={(columnName, dataType) =>
            handleAddColumn({ direction: "left", columnName, dataType })
          }
          onCancel={() => setMenu(undefined)}
        />

        <AddColumnSub
          direction="right"
          onAdd={(columnName, dataType) =>
            handleAddColumn({ direction: "right", columnName, dataType })
          }
          onCancel={() => setMenu(undefined)}
        />

        <DropdownMenuSeparator />

        {/* There is a bug `undefined (reading 'headerRowMarkerDisabled')` when deleting the last column. So we temporarily disable it. */}
        {!isLastColumn && allowRenameDelete && (
          <DropdownMenuItem
            onClick={handleDeleteColumn}
            className="text-destructive focus:text-destructive"
          >
            <TrashIcon className={iconClassName} />
            Delete column
          </DropdownMenuItem>
        )}
      </>
    );

    return (
      <DropdownMenu
        open={isMenuOpen}
        onOpenChange={(open) => !open && setMenu(undefined)}
      >
        <DropdownMenuContent
          style={{
            left: menu?.bounds.x ?? 0,
            top: (menu?.bounds.y ?? 0) + (menu?.bounds.height ?? 0),
          }}
          className="fixed w-52"
        >
          <DropdownMenuItem onClick={handleCopyColumnName}>
            <CopyIcon className={iconClassName} />
            Copy column name
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleToggleWrapColumn}>
            <WrapTextIcon className={iconClassName} />
            Toggle wrapping
          </DropdownMenuItem>

          {wrappedRowHeightStrategy === "fixed" && (
            <DropdownMenuItem onClick={handleFitHeightToText}>
              <WrapTextIcon className={iconClassName} />
              {isSelectedColumnFitHeight
                ? "Refit height to text"
                : "Fit height to text"}
            </DropdownMenuItem>
          )}

          {!isLargeDataset && bulkEditItems}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div
      className="relative w-full min-w-0"
      onPointerDownCapture={interruptSettlingResizeAnchor}
      onTouchStartCapture={interruptSettlingResizeAnchor}
      onWheelCapture={interruptSettlingResizeAnchor}
    >
      <ErrorBoundary>
        <DataEditor
          ref={dataEditorRef}
          getCellContent={getCellContent}
          columns={columns}
          gridSelection={selection}
          onGridSelectionChange={setSelection}
          rows={data.length}
          overscrollX={50} // Adds padding at the end for resizing the last column
          smoothScrollX={!isLargeDataset} // Disable smooth scrolling to improve performance
          smoothScrollY={!isLargeDataset}
          validateCell={validateCell}
          getCellsForSelection={true}
          onPaste={true}
          showSearch={showSearch}
          fillHandle={true}
          allowedFillDirections="vertical" // We can support all directions, but we need to handle datatype logic
          onKeyDown={onKeyDown}
          height={data.length > 10 ? 450 : undefined}
          rowHeight={
            Array.isArray(rowHeights)
              ? (index: number) => rowHeights[index] ?? FIXED_WRAPPED_ROW_HEIGHT
              : rowHeights
          }
          width={"100%"}
          rowMarkers={{
            kind: "both",
          }}
          rowSelectionMode={"multi"}
          onCellEdited={onCellEdited}
          onColumnResize={onColumnResize}
          onHeaderMenuClick={onHeaderMenuClick}
          onVisibleRegionChanged={onVisibleRegionChanged}
          theme={getGlideTheme(theme)}
          trailingRowOptions={trailingRowOptions}
          onRowAppended={onRowAppend}
          maxColumnAutoWidth={600}
          maxColumnWidth={600}
        />
      </ErrorBoundary>
      {renderDropdownMenu()}

      <div className="absolute bottom-1 right-2 w-26">
        <Button
          variant="destructive"
          size="sm"
          disabled={selection.rows.length === 0}
          className="right-2 h-7"
          onClick={handleDeleteRows}
        >
          {selection.rows.length <= 1 ? "Delete row" : "Delete rows"}
        </Button>
      </div>
    </div>
  );
};

export default GlideDataEditor;
