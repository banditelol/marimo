/* Copyright 2026 Marimo. All rights reserved. */

import { layout as layoutWithPretext, prepare as prepareWithPretext } from "@chenglou/pretext";
import type { DataType } from "@/core/kernel/messages";
import type { GlideWrapThemeMetrics } from "./themes";

export const DEFAULT_ROW_HEIGHT = 34;
export const FIXED_WRAPPED_ROW_HEIGHT = 72;
export const WRAPPED_COLUMN_MIN_WIDTH = 200;

const FALLBACK_APPROX_CHARACTER_WIDTH = 7.2;
const EXTRA_WRAPPED_VERTICAL_PADDING = 2;
const PRETEXT_WIDTH_SAFETY_MARGIN = 8;
const EXTRA_PRETEXT_VERTICAL_PADDING = 2;

export type WrappedRowHeightStrategy =
  | "fixed"
  | "approx"
  | "measureText"
  | "pretext";

type MeasureTextLike = (text: string) => number;

const textWidthCache = new Map<string, number>();
const approximateCharacterWidthCache = new Map<string, number>();
const pretextPreparedTextCache = new Map<string, ReturnType<typeof prepareWithPretext>>();

export function getWrappedColumnWidth(width: number | undefined): number {
  if (width == null) {
    return WRAPPED_COLUMN_MIN_WIDTH;
  }
  return Math.max(width, WRAPPED_COLUMN_MIN_WIDTH);
}

function getApproximateCharacterWidth(
  themeMetrics: GlideWrapThemeMetrics,
): number {
  const cached = approximateCharacterWidthCache.get(themeMetrics.baseFontFull);
  if (cached != null) {
    return cached;
  }

  const measureText = createCanvasTextMeasurer(themeMetrics);
  if (!measureText) {
    return FALLBACK_APPROX_CHARACTER_WIDTH;
  }

  const sample =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const width = measureText(sample) / sample.length;
  approximateCharacterWidthCache.set(themeMetrics.baseFontFull, width);
  return width;
}

function getApproximateLineCount(
  value: string,
  width: number,
  themeMetrics: GlideWrapThemeMetrics,
): number {
  const usableWidth = Math.max(1, width - themeMetrics.cellHorizontalPadding * 2);
  const approximateCharacterWidth = getApproximateCharacterWidth(themeMetrics);
  const charsPerLine = Math.max(1, Math.floor(usableWidth / approximateCharacterWidth));

  return value
    .split("\n")
    .reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

function isWrappableType(dataType: DataType): boolean {
  return dataType === "string" || dataType === "unknown";
}

function createCanvasTextMeasurer(
  themeMetrics: GlideWrapThemeMetrics,
): MeasureTextLike | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  let context: CanvasRenderingContext2D | null = null;

  try {
    context = canvas.getContext("2d");
  } catch {
    return undefined;
  }

  if (!context) {
    return undefined;
  }

  context.font = themeMetrics.baseFontFull;

  return (text: string) => {
    const cacheKey = `${context.font}:${text}`;
    const cached = textWidthCache.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const width = context.measureText(text).width;
    textWidthCache.set(cacheKey, width);
    return width;
  };
}

function getWordSegments(line: string): string[] {
  return line.match(/\S+\s*|\s+/g) ?? [line];
}

function wrapSegments(
  line: string,
  width: number,
  themeMetrics: GlideWrapThemeMetrics,
  measureText: MeasureTextLike,
  getSegments: (line: string) => string[],
): number {
  if (line.length === 0) {
    return 1;
  }

  const usableWidth = Math.max(1, width - themeMetrics.cellHorizontalPadding * 2);
  const segments = getSegments(line);
  let currentLineWidth = 0;
  let currentLineHasContent = false;
  let lineCount = 1;

  for (const segment of segments) {
    const segmentWidth = measureText(segment);

    if (segmentWidth <= usableWidth && currentLineWidth + segmentWidth <= usableWidth) {
      currentLineWidth += segmentWidth;
      currentLineHasContent ||= segment.trim().length > 0;
      continue;
    }

    if (!currentLineHasContent && segmentWidth <= usableWidth) {
      currentLineWidth = segmentWidth;
      currentLineHasContent = segment.trim().length > 0;
      continue;
    }

    if (currentLineHasContent) {
      lineCount += 1;
      currentLineWidth = 0;
      currentLineHasContent = false;
    }

    if (segmentWidth <= usableWidth) {
      currentLineWidth = segmentWidth;
      currentLineHasContent = segment.trim().length > 0;
      continue;
    }

    let chunk = "";
    for (const character of segment) {
      const nextChunk = chunk + character;
      if (chunk.length > 0 && measureText(nextChunk) > usableWidth) {
        lineCount += 1;
        chunk = character;
        continue;
      }
      chunk = nextChunk;
    }

    currentLineWidth = chunk.length > 0 ? measureText(chunk) : 0;
    currentLineHasContent = chunk.trim().length > 0;
  }

  return lineCount;
}

function getMeasuredLineCount(
  value: string,
  width: number,
  themeMetrics: GlideWrapThemeMetrics,
  getSegments: (line: string) => string[],
): number {
  const measureText = createCanvasTextMeasurer(themeMetrics);
  if (!measureText) {
    return getApproximateLineCount(value, width, themeMetrics);
  }

  return value
    .split("\n")
    .reduce(
      (lines, line) =>
        lines + wrapSegments(line, width, themeMetrics, measureText, getSegments),
      0,
    );
}

function getPretextLineMetrics(
  value: string,
  width: number,
  themeMetrics: GlideWrapThemeMetrics,
): { lineCount: number; height: number } | undefined {
  const usableWidth = Math.max(
    1,
    width - themeMetrics.cellHorizontalPadding * 2 - PRETEXT_WIDTH_SAFETY_MARGIN,
  );
  const fontSize = Number.parseFloat(themeMetrics.baseFontStyle);
  const lineHeight =
    (Number.isFinite(fontSize) ? fontSize : DEFAULT_ROW_HEIGHT) * themeMetrics.lineHeight;
  const cacheKey = `${themeMetrics.baseFontFull}:${value}`;

  let prepared = pretextPreparedTextCache.get(cacheKey);
  if (!prepared) {
    try {
      prepared = prepareWithPretext(value, themeMetrics.baseFontFull, {
        whiteSpace: "pre-wrap",
      });
    } catch {
      return undefined;
    }
    pretextPreparedTextCache.set(cacheKey, prepared);
  }

  try {
    return layoutWithPretext(prepared, usableWidth, lineHeight);
  } catch {
    return undefined;
  }
}

function getLineCount(
  strategy: Exclude<WrappedRowHeightStrategy, "fixed">,
  value: string,
  width: number,
  themeMetrics: GlideWrapThemeMetrics,
): number {
  switch (strategy) {
    case "approx":
      return getApproximateLineCount(value, width, themeMetrics);
    case "measureText":
      return getMeasuredLineCount(value, width, themeMetrics, getWordSegments);
    case "pretext":
      return (
        getPretextLineMetrics(value, width, themeMetrics)?.lineCount ??
        getApproximateLineCount(value, width, themeMetrics)
      );
  }
}

function getWrappedContentHeight(
  lines: number,
  themeMetrics: GlideWrapThemeMetrics,
): number {
  const fontSize = Number.parseFloat(themeMetrics.baseFontStyle);
  const emHeight = Number.isFinite(fontSize) ? fontSize : DEFAULT_ROW_HEIGHT;
  const lineHeight = themeMetrics.lineHeight * emHeight;
  const actualHeight = emHeight + lineHeight * Math.max(0, lines - 1);

  return Math.ceil(
    actualHeight + themeMetrics.cellVerticalPadding * 2 + EXTRA_WRAPPED_VERTICAL_PADDING,
  );
}

function getWrappedHeightForValue(
  strategy: Exclude<WrappedRowHeightStrategy, "fixed">,
  value: string,
  width: number,
  themeMetrics: GlideWrapThemeMetrics,
): number {
  if (strategy === "pretext") {
    const pretextMetrics = getPretextLineMetrics(value, width, themeMetrics);
    const approximateHeight = getWrappedContentHeight(
      getApproximateLineCount(value, width, themeMetrics),
      themeMetrics,
    );
    if (pretextMetrics) {
      const pretextHeight = Math.ceil(
        pretextMetrics.height +
          themeMetrics.cellVerticalPadding * 2 +
          EXTRA_WRAPPED_VERTICAL_PADDING +
          EXTRA_PRETEXT_VERTICAL_PADDING,
      );
      const conservativePretextHeight = getWrappedContentHeight(
        pretextMetrics.lineCount + 1,
        themeMetrics,
      );

      return Math.max(
        approximateHeight,
        conservativePretextHeight,
        pretextHeight,
      );
    }

    return approximateHeight;
  }

  const lines = getLineCount(strategy, value, width, themeMetrics);
  return getWrappedContentHeight(lines, themeMetrics);
}

export function estimateWrappedRowHeights<T>(params: {
  data: T[];
  wrappedColumns: Set<string>;
  columnWidths: Record<string, number>;
  columnDataTypes: Map<string, DataType>;
  strategy: Exclude<WrappedRowHeightStrategy, "fixed">;
  themeMetrics: GlideWrapThemeMetrics;
}): number[] | undefined {
  const {
    data,
    wrappedColumns,
    columnWidths,
    columnDataTypes,
    strategy,
    themeMetrics,
  } = params;

  if (wrappedColumns.size === 0) {
    return undefined;
  }

  const wrappableColumns = [...wrappedColumns].filter((columnName) =>
    isWrappableType(columnDataTypes.get(columnName) ?? "unknown"),
  );

  if (wrappableColumns.length === 0) {
    return undefined;
  }

  return data.map((row) => {
    let maxHeight = DEFAULT_ROW_HEIGHT;

    for (const columnName of wrappableColumns) {
      const rawValue = row[columnName as keyof T];
      const value = rawValue == null ? "" : String(rawValue);
      const wrappedHeight = getWrappedHeightForValue(
        strategy,
        value,
        getWrappedColumnWidth(columnWidths[columnName]),
        themeMetrics,
      );
      maxHeight = Math.max(maxHeight, wrappedHeight);
    }

    return maxHeight;
  });
}
