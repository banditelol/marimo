/* Copyright 2026 Marimo. All rights reserved. */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { FieldTypes } from "@/components/data-table/types";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GlideDataEditor } from "../glide-data-editor";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () =>
      ({
        font: "",
        measureText: (text: string) => ({ width: text.length * 7 }),
      }) as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

interface MockBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MockGridCell {
  allowWrapping?: boolean;
}

interface MockDataEditorProps {
  onHeaderMenuClick?: (columnIndex: number, bounds: MockBounds) => void;
  getCellContent?: (cell: [number, number]) => MockGridCell;
  rowHeight?: number | ((rowIndex: number) => number);
  columns?: Array<{ title: string; width?: number }>;
  onColumnResize?: (column: { title: string }, newSize: number) => void;
  onVisibleRegionChanged?: (region: MockBounds) => void;
}

let latestDataEditorProps: MockDataEditorProps | undefined;
const mockScrollTo = vi.hoisted(() => vi.fn());

vi.mock("@glideapps/glide-data-grid", () => {
  return {
    __esModule: true,
    default: forwardRef<unknown, MockDataEditorProps>((props, ref) => {
      useImperativeHandle(ref, () => ({
        scrollTo: mockScrollTo,
      }));
      latestDataEditorProps = props;
      return (
        <div>
          <div className="dvn-scroller" />
          <button
            type="button"
            onClick={() =>
              props.onHeaderMenuClick?.(0, {
                x: 0,
                y: 0,
                width: 20,
                height: 20,
              })
            }
          >
            Open header menu
          </button>
        </div>
      );
    }),
    CompactSelection: {
      empty: () => ({ toArray: () => [], length: 0 }),
    },
    GridCellKind: {
      Boolean: "Boolean",
      Number: "Number",
      Text: "Text",
    },
    GridColumnIcon: {
      ProtectedColumnOverlay: "ProtectedColumnOverlay",
      HeaderString: "HeaderString",
    },
    getDefaultTheme: () => ({
      baseFontStyle: "13px",
      fontFamily: "Inter, sans-serif",
      lineHeight: 1.4,
      cellHorizontalPadding: 8,
      cellVerticalPadding: 3,
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mockScrollTo.mockClear();
  latestDataEditorProps = undefined;
});

vi.mock("@/theme/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

vi.mock("@/hooks/useNonce", () => ({
  useNonce: () => vi.fn(),
}));

vi.mock("@/utils/copy", () => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
}));

describe("GlideDataEditor", () => {
  const columnFields: FieldTypes = new Map([["notes", "string"]]);

  const baseProps = {
    data: [
      { notes: "a very long note" },
      {
        notes:
          "This is a much longer note that should wrap onto multiple lines in the dynamic row-height path.",
      },
    ],
    setData: vi.fn(),
    columnFields,
    setColumnFields: vi.fn(),
    editableColumns: "all" as const,
    edits: [],
    onAddEdits: vi.fn(),
    onAddRows: vi.fn(),
    onDeleteRows: vi.fn(),
    onRenameColumn: vi.fn(),
    onDeleteColumn: vi.fn(),
    onAddColumn: vi.fn(),
  };

  it("seeds wrapped columns from props and toggles wrapping", () => {
    const { rerender } = render(
      <GlideDataEditor {...baseProps} wrappedColumns={["notes"]} />,
    );

    expect(typeof latestDataEditorProps?.rowHeight).toBe("function");
    expect(latestDataEditorProps?.columns?.[0]?.width).toBe(200);
    expect(
      typeof latestDataEditorProps?.rowHeight === "function"
        ? latestDataEditorProps.rowHeight(1)
        : 0,
    ).toBeGreaterThan(
      typeof latestDataEditorProps?.rowHeight === "function"
        ? latestDataEditorProps.rowHeight(0)
        : 0,
    );

    const wrappedCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(wrappedCell).toMatchObject({ allowWrapping: true });

    fireEvent.click(screen.getByText("Open header menu"));
    fireEvent.click(screen.getByText("Toggle wrapping"));

    const unwrappedCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(unwrappedCell).toMatchObject({ allowWrapping: false });
    expect(latestDataEditorProps?.rowHeight).toBeUndefined();
    expect(latestDataEditorProps?.columns?.[0]?.width).toBeUndefined();

    rerender(<GlideDataEditor {...baseProps} wrappedColumns={[]} />);

    const clearedCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(clearedCell).toMatchObject({ allowWrapping: false });
    expect(latestDataEditorProps?.rowHeight).toBeUndefined();

    rerender(<GlideDataEditor {...baseProps} wrappedColumns={["notes"]} />);

    const wrappedAgainCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(wrappedAgainCell).toMatchObject({ allowWrapping: true });
    expect(typeof latestDataEditorProps?.rowHeight).toBe("function");
    expect(latestDataEditorProps?.columns?.[0]?.width).toBe(200);
  });

  it("fits height to text once for fixed-height variant", () => {
    render(
      <GlideDataEditor
        {...baseProps}
        wrappedColumns={[]}
        wrappedRowHeightStrategy="fixed"
      />,
    );

    expect(latestDataEditorProps?.rowHeight).toBeUndefined();

    fireEvent.click(screen.getByText("Open header menu"));
    fireEvent.click(screen.getByText("Fit height to text"));

    expect(latestDataEditorProps?.columns?.[0]?.width).toBe(200);
    expect(typeof latestDataEditorProps?.rowHeight).toBe("function");
    expect(
      typeof latestDataEditorProps?.rowHeight === "function"
        ? latestDataEditorProps.rowHeight(1)
        : 0,
    ).toBeGreaterThan(
      typeof latestDataEditorProps?.rowHeight === "function"
        ? latestDataEditorProps.rowHeight(0)
        : 0,
    );

    fireEvent.click(screen.getByText("Open header menu"));
    fireEvent.click(screen.getByText("Toggle wrapping"));

    expect(latestDataEditorProps?.rowHeight).toBeUndefined();
  });

  it("keeps approximate row height stable during active resize", () => {
    vi.useFakeTimers();

    const deferredProps = {
      ...baseProps,
      data: [
        { notes: "short" },
        {
          notes:
            "This is a much longer note that should definitely wrap across many more lines when the width is narrow and then collapse once the resized width has been committed after release.",
        },
      ],
    };

    render(
      <GlideDataEditor
        {...deferredProps}
        wrappedColumns={["notes"]}
        wrappedRowHeightStrategy="approxDeferred"
      />,
    );

    const initialHeight =
      typeof latestDataEditorProps?.rowHeight === "function"
        ? latestDataEditorProps.rowHeight(1)
        : 0;

    act(() => {
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 600);
    });

    expect(latestDataEditorProps?.columns?.[0]?.width).toBe(600);

    const beforeSettleHeight =
      typeof latestDataEditorProps?.rowHeight === "function"
        ? latestDataEditorProps.rowHeight(1)
        : 0;

    expect(beforeSettleHeight).toBe(initialHeight);

    act(() => {
      window.dispatchEvent(new Event("pointerup"));
      vi.runAllTimers();
    });
    vi.useRealTimers();
  });

  function getRowHeight(rowIndex: number): number {
    return typeof latestDataEditorProps?.rowHeight === "function"
      ? latestDataEditorProps.rowHeight(rowIndex)
      : 0;
  }

  function flushAnimationFrames(
    queuedFrames: FrameRequestCallback[],
    count: number,
  ) {
    act(() => {
      for (let index = 0; index < count; index += 1) {
        const frame = queuedFrames.shift();
        frame?.(performance.now() + 1000);
      }
    });
  }

  function makeIncrementalData(length: number) {
    return Array.from({ length }, (_, index) => ({
      notes:
        index === 0 ||
        index === 20 ||
        index === 110 ||
        index === 120 ||
        index === 180
          ? "This is a much longer note that should wrap across multiple lines in incremental sizing mode to make batched updates observable in the test harness."
          : "short",
    }));
  }

  it("renders baseline approximate incremental heights from the visible window without scroll correction", () => {
    vi.useFakeTimers();
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(
      <GlideDataEditor
        {...baseProps}
        data={Array.from({ length: 250 }, (_, index) => ({
          notes:
            index === 0 || index === 110 || index === 120
              ? "This is a much longer note that should wrap across multiple lines in incremental sizing mode to make batched updates observable in the test harness."
              : "short",
        }))}
        wrappedColumns={["notes"]}
        wrappedRowHeightStrategy="approxIncrementalBaseline"
      />,
    );

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 120,
        width: 1,
        height: 10,
      });
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 260);
    });

    expect(getRowHeight(0)).toBe(34);
    expect(getRowHeight(110)).toBe(34);
    expect(getRowHeight(120)).toBe(34);
    expect(queuedFrames.length).toBeGreaterThan(0);

    flushAnimationFrames(queuedFrames, 8);

    expect(getRowHeight(0)).toBe(34);
    expect(getRowHeight(110)).toBe(34);
    expect(getRowHeight(120)).toBeGreaterThan(34);
    expect(mockScrollTo).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    flushAnimationFrames(queuedFrames, 8);

    expect(getRowHeight(110)).toBeGreaterThan(34);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("snaps approximate incremental resize once after rows above the anchor settle", () => {
    vi.useFakeTimers();
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(
      <GlideDataEditor
        {...baseProps}
        data={makeIncrementalData(250)}
        wrappedColumns={["notes"]}
        wrappedRowHeightStrategy="approxIncremental"
      />,
    );

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 120,
        width: 1,
        height: 10,
      });
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 260);
    });

    flushAnimationFrames(queuedFrames, 8);

    expect(getRowHeight(0)).toBe(34);
    expect(getRowHeight(110)).toBe(34);
    expect(getRowHeight(120)).toBeGreaterThan(34);
    expect(mockScrollTo).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    flushAnimationFrames(queuedFrames, 8);

    expect(mockScrollTo).toHaveBeenCalledTimes(1);
    expect(mockScrollTo).toHaveBeenLastCalledWith(0, 120, "vertical", 0, 0, {
      vAlign: "start",
    });

    mockScrollTo.mockClear();

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 180,
        width: 1,
        height: 10,
      });
    });
    flushAnimationFrames(queuedFrames, 8);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("captures a fresh top row for a subsequent approximate incremental resize", () => {
    vi.useFakeTimers();
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(
      <GlideDataEditor
        {...baseProps}
        data={makeIncrementalData(250)}
        wrappedColumns={["notes"]}
        wrappedRowHeightStrategy="approxIncremental"
      />,
    );

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 120,
        width: 1,
        height: 10,
      });
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 260);
      vi.runOnlyPendingTimers();
    });
    flushAnimationFrames(queuedFrames, 8);

    expect(mockScrollTo).toHaveBeenLastCalledWith(0, 120, "vertical", 0, 0, {
      vAlign: "start",
    });
    mockScrollTo.mockClear();

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 180,
        width: 1,
        height: 10,
      });
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 300);
      vi.runOnlyPendingTimers();
    });
    flushAnimationFrames(queuedFrames, 8);

    expect(mockScrollTo).toHaveBeenCalledTimes(1);
    expect(mockScrollTo).toHaveBeenLastCalledWith(0, 180, "vertical", 0, 0, {
      vAlign: "start",
    });
  });

  it("ignores stale pending snaps from earlier approximate incremental resizes", () => {
    vi.useFakeTimers();
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    render(
      <GlideDataEditor
        {...baseProps}
        data={makeIncrementalData(250)}
        wrappedColumns={["notes"]}
        wrappedRowHeightStrategy="approxIncremental"
      />,
    );

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 120,
        width: 1,
        height: 10,
      });
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 260);
      vi.runOnlyPendingTimers();
    });
    flushAnimationFrames(queuedFrames, 3);

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 180,
        width: 1,
        height: 10,
      });
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 300);
    });
    flushAnimationFrames(queuedFrames, 8);

    expect(mockScrollTo).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });
    flushAnimationFrames(queuedFrames, 8);

    expect(mockScrollTo).toHaveBeenCalledTimes(1);
    expect(mockScrollTo).toHaveBeenLastCalledWith(0, 180, "vertical", 0, 0, {
      vAlign: "start",
    });
  });

  it("cancels a pending approximate incremental resize snap on user scroll input", () => {
    vi.useFakeTimers();
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    const { container } = render(
      <GlideDataEditor
        {...baseProps}
        data={makeIncrementalData(250)}
        wrappedColumns={["notes"]}
        wrappedRowHeightStrategy="approxIncremental"
      />,
    );

    act(() => {
      latestDataEditorProps?.onVisibleRegionChanged?.({
        x: 0,
        y: 120,
        width: 1,
        height: 10,
      });
      latestDataEditorProps?.onColumnResize?.({ title: "notes" }, 260);
      vi.runOnlyPendingTimers();
    });
    flushAnimationFrames(queuedFrames, 3);

    const editorRoot = container.firstElementChild;
    if (!editorRoot) {
      throw new Error("Expected data editor root to render");
    }
    fireEvent.wheel(editorRoot);
    flushAnimationFrames(queuedFrames, 8);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });
});
