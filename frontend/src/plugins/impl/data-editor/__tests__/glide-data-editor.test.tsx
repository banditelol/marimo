/* Copyright 2026 Marimo. All rights reserved. */

import { fireEvent, render, screen } from "@testing-library/react";
import type { FieldTypes } from "@/components/data-table/types";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GlideDataEditor } from "../glide-data-editor";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() =>
    ({
      font: "",
      measureText: (text: string) => ({ width: text.length * 7 }),
    }) as unknown as CanvasRenderingContext2D,
  );
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
}

let latestDataEditorProps: MockDataEditorProps | undefined;

vi.mock("@glideapps/glide-data-grid", () => {
  return {
    __esModule: true,
    default: (props: MockDataEditorProps) => {
      latestDataEditorProps = props;
      return (
        <button
          onClick={() =>
            props.onHeaderMenuClick?.(0, { x: 0, y: 0, width: 20, height: 20 })
          }
        >
          Open header menu
        </button>
      );
    },
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
});
