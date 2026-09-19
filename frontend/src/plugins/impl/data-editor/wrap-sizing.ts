/* Copyright 2026 Marimo. All rights reserved. */

import { GridCellKind } from "@glideapps/glide-data-grid";
import type { ModifiedGridColumn } from "./types";

export const DEFAULT_ROW_HEIGHT = 34;
export const DEFAULT_WRAP_COLUMN_WIDTH = 200;
export const ROUGH_RESIZE_ROW_BUFFER = 20;
export const ROUGH_RESIZE_SETTLE_MS = 120;

const APPROX_CHAR_WIDTH_PX = 7.2;
const APPROX_LINE_HEIGHT_PX = 20;
const COLUMN_CONTENT_PADDING_PX = 32;
const MIN_CONTENT_WIDTH_PX = 48;

export interface VisibleRowWindow {
  start: number;
  end: number;
}

export type WrappedRowHeightStrategy = "fixed" | "approxIncrementalRough";

export type RoughRowHeights =
  | {
      mode: "window";
      startRow: number;
      endRow: number;
      height: number;
    }
  | {
      mode: "all";
      height: number;
    }
  | undefined;

export interface RoughHeightMeasurementSummary {
  sampledHeight: number;
  sampledRows: number;
  wrappedColumnCount: number;
  maxRow: number;
  maxRowHeight: number;
}

export function getVisibleRowWindow(range: {
  y: number;
  height: number;
}): VisibleRowWindow {
  const start = Math.max(0, range.y);
  const end = Math.max(start, range.y + Math.max(range.height - 1, 0));
  return { start, end };
}

export function expandVisibleRowWindow(
  visibleRowWindow: VisibleRowWindow,
  totalRows: number,
  buffer = ROUGH_RESIZE_ROW_BUFFER,
): VisibleRowWindow {
  if (totalRows <= 0) {
    return { start: 0, end: 0 };
  }

  return {
    start: Math.max(0, visibleRowWindow.start - buffer),
    end: Math.min(totalRows - 1, visibleRowWindow.end + buffer),
  };
}

export function getTextCellDisplayValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function estimateWrappedTextHeight(
  value: unknown,
  columnWidth: number,
): number {
  const text = getTextCellDisplayValue(value);
  if (text.length === 0) {
    return DEFAULT_ROW_HEIGHT;
  }

  const contentWidth = Math.max(
    MIN_CONTENT_WIDTH_PX,
    columnWidth - COLUMN_CONTENT_PADDING_PX,
  );
  const charsPerLine = Math.max(1, Math.floor(contentWidth / APPROX_CHAR_WIDTH_PX));

  let lines = 0;
  for (const segment of text.split("\n")) {
    lines += Math.max(1, Math.ceil(segment.length / charsPerLine));
  }

  return Math.max(
    DEFAULT_ROW_HEIGHT,
    Math.ceil(lines * APPROX_LINE_HEIGHT_PX + 14),
  );
}

export function measureRoughWrappedRowHeight<T extends Record<string, unknown>>({
  columns,
  data,
  getColumnWidth,
  sampleWindow,
  wrappedColumns,
}: {
  columns: ModifiedGridColumn[];
  data: T[];
  getColumnWidth: (columnTitle: string) => number;
  sampleWindow: VisibleRowWindow;
  wrappedColumns: ReadonlySet<string>;
}): RoughHeightMeasurementSummary {
  if (wrappedColumns.size === 0 || data.length === 0) {
    return {
      maxRow: sampleWindow.start,
      maxRowHeight: DEFAULT_ROW_HEIGHT,
      sampledHeight: DEFAULT_ROW_HEIGHT,
      sampledRows: 0,
      wrappedColumnCount: 0,
    };
  }

  const wrappedGridColumns = columns.filter(
    (column) =>
      column.kind === GridCellKind.Text && wrappedColumns.has(column.title),
  );

  if (wrappedGridColumns.length === 0) {
    return {
      maxRow: sampleWindow.start,
      maxRowHeight: DEFAULT_ROW_HEIGHT,
      sampledHeight: DEFAULT_ROW_HEIGHT,
      sampledRows: 0,
      wrappedColumnCount: 0,
    };
  }

  let sampledHeight = DEFAULT_ROW_HEIGHT;
  let maxRow = sampleWindow.start;
  let sampledRows = 0;
  for (let row = sampleWindow.start; row <= sampleWindow.end; row++) {
    const rowData = data[row];
    if (rowData === undefined) {
      continue;
    }
    sampledRows += 1;

    let rowHeight = DEFAULT_ROW_HEIGHT;
    for (const column of wrappedGridColumns) {
      rowHeight = Math.max(
        rowHeight,
        estimateWrappedTextHeight(
          rowData[column.title as keyof T],
          getColumnWidth(column.title),
        ),
      );
    }

    if (rowHeight > sampledHeight) {
      sampledHeight = rowHeight;
      maxRow = row;
    }
  }

  return {
    maxRow,
    maxRowHeight: sampledHeight,
    sampledHeight,
    sampledRows,
    wrappedColumnCount: wrappedGridColumns.length,
  };
}

export function getRowHeight(
  row: number,
  totalRows: number,
  roughRowHeights: RoughRowHeights,
): number {
  if (row >= totalRows) {
    return DEFAULT_ROW_HEIGHT;
  }

  if (roughRowHeights === undefined) {
    return DEFAULT_ROW_HEIGHT;
  }

  if (roughRowHeights.mode === "all") {
    return roughRowHeights.height;
  }

  return row >= roughRowHeights.startRow && row <= roughRowHeights.endRow
    ? roughRowHeights.height
    : DEFAULT_ROW_HEIGHT;
}
