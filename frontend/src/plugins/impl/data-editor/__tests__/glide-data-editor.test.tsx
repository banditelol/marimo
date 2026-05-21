/* Copyright 2026 Marimo. All rights reserved. */

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { GlideDataEditor } from "../glide-data-editor";

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
  rowHeight?: number;
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
  const baseProps = {
    data: [{ notes: "a very long note" }],
    setData: vi.fn(),
    columnFields: new Map([["notes", "string"]]),
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

  it("seeds wrapped columns from props and toggles wrap text", () => {
    const { rerender } = render(
      <GlideDataEditor {...baseProps} wrappedColumns={["notes"]} />,
    );

    expect(latestDataEditorProps?.rowHeight).toBe(72);

    const wrappedCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(wrappedCell).toMatchObject({ allowWrapping: true });

    fireEvent.click(screen.getByText("Open header menu"));
    fireEvent.click(screen.getByText("No wrap text"));

    const unwrappedCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(unwrappedCell).toMatchObject({ allowWrapping: false });
    expect(latestDataEditorProps?.rowHeight).toBeUndefined();

    rerender(<GlideDataEditor {...baseProps} wrappedColumns={[]} />);

    const clearedCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(clearedCell).toMatchObject({ allowWrapping: false });
    expect(latestDataEditorProps?.rowHeight).toBeUndefined();

    rerender(<GlideDataEditor {...baseProps} wrappedColumns={["notes"]} />);

    const wrappedAgainCell = latestDataEditorProps?.getCellContent?.([0, 0]);
    expect(wrappedAgainCell).toMatchObject({ allowWrapping: true });
    expect(latestDataEditorProps?.rowHeight).toBe(72);
  });
});
