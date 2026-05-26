/* Copyright 2026 Marimo. All rights reserved. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ROW_HEIGHT,
  estimateWrappedRowHeights,
  getWrappedColumnWidth,
  WRAPPED_COLUMN_MIN_WIDTH,
} from "../wrap-sizing";
import { getGlideWrapThemeMetrics } from "../themes";

const themeMetrics = getGlideWrapThemeMetrics("light");

const measureText = vi.fn((text: string) => ({ width: text.length * 7 }));

afterEach(() => {
  measureText.mockClear();
  vi.unstubAllGlobals();
});

HTMLCanvasElement.prototype.getContext = vi.fn(
  () =>
    ({
      font: "",
      measureText,
    }) as unknown as CanvasRenderingContext2D,
) as unknown as typeof HTMLCanvasElement.prototype.getContext;

describe("wrap-sizing", () => {
  it("enforces a minimum wrapped column width", () => {
    expect(getWrappedColumnWidth(undefined)).toBe(WRAPPED_COLUMN_MIN_WIDTH);
    expect(getWrappedColumnWidth(120)).toBe(WRAPPED_COLUMN_MIN_WIDTH);
    expect(getWrappedColumnWidth(260)).toBe(260);
  });

  it("estimates taller rows for longer wrapped text", () => {
    const rowHeights = estimateWrappedRowHeights({
      data: [
        { notes: "short" },
        {
          notes:
            "This is a much longer note that should wrap across multiple lines when the wrapped width is constrained.",
        },
      ],
      wrappedColumns: new Set(["notes"]),
      columnWidths: { notes: 200 },
      columnDataTypes: new Map([["notes", "string"]]),
      strategy: "approx",
      themeMetrics,
    });

    expect(rowHeights).toBeDefined();
    expect(rowHeights?.[0]).toBe(DEFAULT_ROW_HEIGHT);
    expect(rowHeights?.[1]).toBeGreaterThan(DEFAULT_ROW_HEIGHT);
  });

  it("ignores non-text wrapped columns for row height estimation", () => {
    const rowHeights = estimateWrappedRowHeights({
      data: [{ value: 123456789 }],
      wrappedColumns: new Set(["value"]),
      columnWidths: { value: 200 },
      columnDataTypes: new Map([["value", "number"]]),
      strategy: "approx",
      themeMetrics,
    });

    expect(rowHeights).toBeUndefined();
  });

  it("uses wider columns to reduce measured height", () => {
    const narrowHeights = estimateWrappedRowHeights({
      data: [{ notes: "one two three four five six seven eight nine ten" }],
      wrappedColumns: new Set(["notes"]),
      columnWidths: { notes: 200 },
      columnDataTypes: new Map([["notes", "string"]]),
      strategy: "measureText",
      themeMetrics,
    });

    const wideHeights = estimateWrappedRowHeights({
      data: [{ notes: "one two three four five six seven eight nine ten" }],
      wrappedColumns: new Set(["notes"]),
      columnWidths: { notes: 400 },
      columnDataTypes: new Map([["notes", "string"]]),
      strategy: "measureText",
      themeMetrics,
    });

    expect(narrowHeights?.[0]).toBeGreaterThanOrEqual(wideHeights?.[0] ?? 0);
  });

  it("counts explicit newlines for measured strategies", () => {
    const rowHeights = estimateWrappedRowHeights({
      data: [{ notes: "short\nshort\nshort" }],
      wrappedColumns: new Set(["notes"]),
      columnWidths: { notes: 400 },
      columnDataTypes: new Map([["notes", "string"]]),
      strategy: "measureText",
      themeMetrics,
    });

    expect(rowHeights?.[0]).toBeGreaterThan(DEFAULT_ROW_HEIGHT);
  });

  it("falls back from direct pretext strategy when segmenter is unavailable", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });

    const rowHeights = estimateWrappedRowHeights({
      data: [{ notes: "segment fallback text for measurement" }],
      wrappedColumns: new Set(["notes"]),
      columnWidths: { notes: 200 },
      columnDataTypes: new Map([["notes", "string"]]),
      strategy: "pretext",
      themeMetrics,
    });

    const approximateHeights = estimateWrappedRowHeights({
      data: [{ notes: "segment fallback text for measurement" }],
      wrappedColumns: new Set(["notes"]),
      columnWidths: { notes: 200 },
      columnDataTypes: new Map([["notes", "string"]]),
      strategy: "approx",
      themeMetrics,
    });

    expect(rowHeights).toEqual(approximateHeights);
  });
});
