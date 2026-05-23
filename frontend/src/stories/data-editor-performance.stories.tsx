/* Copyright 2026 Marimo. All rights reserved. */

import { Profiler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldTypes } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { GlideDataEditor } from "@/plugins/impl/data-editor/glide-data-editor";
import {
  estimateWrappedRowHeights,
  type WrappedRowHeightStrategy,
} from "@/plugins/impl/data-editor/wrap-sizing";
import { getGlideWrapThemeMetrics } from "@/plugins/impl/data-editor/themes";

export default {
  title: "DataEditor/Performance",
};

type Row = {
  id: number;
  title: string;
  notes: string;
  status: string;
};

type BenchmarkRun = {
  id: number;
  iterations: number;
  stopId: number;
};

type BenchmarkMetrics = {
  label: string;
  commits: number;
  totalMs: number;
  averageMs: number;
  maxMs: number;
  wallMs: number;
  completedIterations: number;
};

const MAX_MULTI_VISUAL_ROWS = 5000;
const MAX_SINGLE_VISUAL_ROWS = 10000;
const SYNTHETIC_CHUNK_SIZE = 1000;
const SYNTHETIC_THEME_METRICS = getGlideWrapThemeMetrics("light");
const SYNTHETIC_COLUMN_TYPES = new Map<string, "string">([["notes", "string"]]);

const NOTE_VARIANTS = [
  {
    title: "Short note",
    notes: "Short note.",
    status: "baseline",
  },
  {
    title: "Paragraph wrap",
    notes:
      "This is a much longer note intended to wrap across multiple lines so we can compare how expensive the dynamic row-height strategy is relative to the previous fixed wrapped height approach.",
    status: "spaces",
  },
  {
    title: "Explicit newlines",
    notes:
      "Step 1: collect data\nStep 2: validate the rows\nStep 3: compare wrapping output across strategies",
    status: "newlines",
  },
  {
    title: "Long token",
    notes:
      "supercalifragilisticexpialidocious_supercalifragilisticexpialidocious_supercalifragilisticexpialidocious",
    status: "token",
  },
  {
    title: "Mixed punctuation",
    notes:
      "IDs: alpha-001, beta-002, gamma-003; owners: ops@example.com, qa@example.com, infra@example.com.",
    status: "punctuation",
  },
  {
    title: "Segment-heavy",
    notes:
      "Tokyo rail updates 東京駅から新宿駅まで quickly-change status labels and compare word segmentation behavior.",
    status: "segmenter",
  },
] as const;

const STRATEGIES: Array<{
  label: string;
  strategy: WrappedRowHeightStrategy;
}> = [
  { label: "Fixed wrapped height", strategy: "fixed" },
  { label: "Approximate dynamic", strategy: "approx" },
  { label: "Canvas measureText", strategy: "measureText" },
  { label: "Pretext", strategy: "pretext" },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const variant = NOTE_VARIANTS[index % NOTE_VARIANTS.length];

    return {
      id: index + 1,
      title: `${variant.title} ${index + 1}`,
      notes: variant.notes,
      status: variant.status,
    };
  });
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function makeSyntheticChunk(offset: number, size: number): Row[] {
  return Array.from({ length: size }, (_, index) => {
    const rowIndex = offset + index;
    const variant = NOTE_VARIANTS[rowIndex % NOTE_VARIANTS.length];

    return {
      id: rowIndex + 1,
      title: `${variant.title} ${rowIndex + 1}`,
      notes: variant.notes,
      status: variant.status,
    };
  });
}

function runSyntheticSizingBenchmarkForStrategy(
  rowCount: number,
  selectedStrategy: Exclude<WrappedRowHeightStrategy, "measureText">,
): Partial<Record<WrappedRowHeightStrategy, BenchmarkMetrics>> {
  const results: Partial<Record<WrappedRowHeightStrategy, BenchmarkMetrics>> = {};
  const selectedEntry = STRATEGIES.find(
    ({ strategy }) => strategy === selectedStrategy,
  );

  if (!selectedEntry) {
    return results;
  }

  const start = performance.now();
  let processedRows = 0;

  if (selectedStrategy === "fixed") {
    const wallMs = performance.now() - start;
    results.fixed = {
      label: selectedEntry.label,
      commits: 0,
      totalMs: wallMs,
      averageMs: wallMs,
      maxMs: wallMs,
      wallMs,
      completedIterations: 1,
    };
    return results;
  }

  while (processedRows < rowCount) {
    const chunkSize = Math.min(SYNTHETIC_CHUNK_SIZE, rowCount - processedRows);
    const chunk = makeSyntheticChunk(processedRows, chunkSize);
    estimateWrappedRowHeights({
      data: chunk,
      wrappedColumns: new Set(["notes"]),
      columnWidths: { notes: 200 },
      columnDataTypes: SYNTHETIC_COLUMN_TYPES,
      strategy: selectedStrategy,
      themeMetrics: SYNTHETIC_THEME_METRICS,
    });
    processedRows += chunkSize;
  }

  const wallMs = performance.now() - start;
  results[selectedStrategy] = {
    label: selectedEntry.label,
    commits: 0,
    totalMs: wallMs,
    averageMs: wallMs,
    maxMs: wallMs,
    wallMs,
    completedIterations: 1,
  };

  return results;
}

function PerformanceSummary({
  rows,
  iterations,
  results,
  summaryStrategies,
}: {
  rows: number;
  iterations: number;
  results: Partial<Record<WrappedRowHeightStrategy, BenchmarkMetrics>>;
  summaryStrategies: Array<{
    label: string;
    strategy: WrappedRowHeightStrategy;
  }>;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
        <div className="font-medium">Benchmark summary</div>
      <div className="mt-1 text-sm text-muted-foreground">
        {rows > MAX_SINGLE_VISUAL_ROWS
          ? `Synthetic sizing benchmark with ${rows.toLocaleString()} rows.`
          : `Controlled rerender run with ${rows.toLocaleString()} rows and ${iterations} iterations.`}
        </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4 font-medium">Strategy</th>
              <th className="py-2 pr-4 font-medium">Iterations</th>
              <th className="py-2 pr-4 font-medium">Commits</th>
              <th className="py-2 pr-4 font-medium">Profiler total</th>
              <th className="py-2 pr-4 font-medium">Avg commit</th>
              <th className="py-2 pr-4 font-medium">Max commit</th>
              <th className="py-2 font-medium">Wall time</th>
            </tr>
          </thead>
          <tbody>
            {summaryStrategies.map(({ label, strategy }) => {
              const result = results[strategy];
              return (
                <tr key={strategy} className="border-b last:border-0">
                  <td className="py-2 pr-4">{label}</td>
                  <td className="py-2 pr-4">
                    {rows > MAX_SINGLE_VISUAL_ROWS
                      ? `${result?.completedIterations ?? 0}/1`
                      : `${result?.completedIterations ?? 0}/${iterations}`}
                  </td>
                  <td className="py-2 pr-4">{result?.commits ?? 0}</td>
                  <td className="py-2 pr-4">
                    {result ? formatMs(result.totalMs) : "-"}
                  </td>
                  <td className="py-2 pr-4">
                    {result ? formatMs(result.averageMs) : "-"}
                  </td>
                  <td className="py-2 pr-4">
                    {result ? formatMs(result.maxMs) : "-"}
                  </td>
                  <td className="py-2">{result ? formatMs(result.wallMs) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditorHarness({
  label,
  strategy,
  rows,
  benchmarkRun,
  onBenchmarkComplete,
}: {
  label: string;
  strategy: WrappedRowHeightStrategy;
  rows: Row[];
  benchmarkRun: BenchmarkRun;
  onBenchmarkComplete: (
    strategy: WrappedRowHeightStrategy,
    metrics: BenchmarkMetrics,
  ) => void;
}) {
  const [data, setData] = useState(rows);
  const [columnFields, setColumnFields] = useState(
    (): FieldTypes =>
      new Map([
        ["id", "integer"],
        ["title", "string"],
        ["notes", "string"],
        ["status", "string"],
      ]),
  );
  const [isBenchmarkRunning, setIsBenchmarkRunning] = useState(false);
  const metricsRef = useRef({ commits: 0, totalMs: 0, lastMs: 0, maxMs: 0 });
  const benchmarkStateRef = useRef<{
    runId: number;
    commits: number;
    totalMs: number;
    maxMs: number;
    startTime: number;
    completedIterations: number;
  } | null>(null);

  useEffect(() => {
    setData(rows);
  }, [rows]);

  useEffect(() => {
    if (benchmarkRun.id === 0 || benchmarkRun.iterations <= 0) {
      return;
    }

    let cancelled = false;
    let frameId: number | null = null;

    benchmarkStateRef.current = {
      runId: benchmarkRun.id,
      commits: 0,
      totalMs: 0,
      maxMs: 0,
      startTime: performance.now(),
      completedIterations: 0,
    };
    setIsBenchmarkRunning(true);

    const runIteration = (remaining: number) => {
      if (cancelled) {
        return;
      }

      if (remaining === 0) {
        const benchmarkState = benchmarkStateRef.current;
        if (!benchmarkState || benchmarkState.runId !== benchmarkRun.id) {
          return;
        }

        benchmarkStateRef.current = null;
        setIsBenchmarkRunning(false);
        onBenchmarkComplete(strategy, {
          label,
          commits: benchmarkState.commits,
          totalMs: benchmarkState.totalMs,
          averageMs:
            benchmarkState.commits > 0
              ? benchmarkState.totalMs / benchmarkState.commits
              : 0,
          maxMs: benchmarkState.maxMs,
          wallMs: performance.now() - benchmarkState.startTime,
          completedIterations: benchmarkState.completedIterations,
        });
        return;
      }

      frameId = requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        setData((prev) => [...prev]);

        frameId = requestAnimationFrame(() => {
          const benchmarkState = benchmarkStateRef.current;
          if (cancelled || !benchmarkState || benchmarkState.runId !== benchmarkRun.id) {
            return;
          }

          benchmarkState.completedIterations += 1;
          runIteration(remaining - 1);
        });
      });
    };

    runIteration(benchmarkRun.iterations);

    return () => {
      cancelled = true;
      benchmarkStateRef.current = null;
      if (frameId != null) {
        cancelAnimationFrame(frameId);
      }
      setIsBenchmarkRunning(false);
    };
  }, [benchmarkRun.id, benchmarkRun.iterations, benchmarkRun.stopId, label, onBenchmarkComplete, strategy]);

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-sm text-muted-foreground">
            commits: {metricsRef.current.commits} | last: {metricsRef.current.lastMs.toFixed(1)} ms | total: {metricsRef.current.totalMs.toFixed(1)} ms
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          {isBenchmarkRunning ? "Benchmark running" : "Idle"}
        </div>
      </div>
      <Profiler
        id={label}
        onRender={(_id, _phase, actualDuration) => {
          metricsRef.current = {
            commits: metricsRef.current.commits + 1,
            totalMs: metricsRef.current.totalMs + actualDuration,
            lastMs: actualDuration,
            maxMs: Math.max(metricsRef.current.maxMs, actualDuration),
          };

          const benchmarkState = benchmarkStateRef.current;
          if (benchmarkState && benchmarkState.runId === benchmarkRun.id) {
            benchmarkState.commits += 1;
            benchmarkState.totalMs += actualDuration;
            benchmarkState.maxMs = Math.max(benchmarkState.maxMs, actualDuration);
          }
        }}
      >
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
      </Profiler>
    </div>
  );
}

export const WrapHeightComparison = {
  render: () => {
    const [rows, setRows] = useState(200);
    const [iterations, setIterations] = useState(20);
    const [benchmarkRun, setBenchmarkRun] = useState<BenchmarkRun>({
      id: 0,
      iterations,
      stopId: 0,
    });
    const [results, setResults] = useState<
      Partial<Record<WrappedRowHeightStrategy, BenchmarkMetrics>>
    >({});
    const data = useMemo(() => makeRows(rows), [rows]);
    const [isBenchmarkRunning, setIsBenchmarkRunning] = useState(false);
    const isSingleVisualBenchmark =
      rows > MAX_MULTI_VISUAL_ROWS && rows <= MAX_SINGLE_VISUAL_ROWS;
    const isSyntheticBenchmark = rows > MAX_SINGLE_VISUAL_ROWS;
    const [largeRowStrategy, setLargeRowStrategy] = useState<
      Exclude<WrappedRowHeightStrategy, "measureText">
    >("approx");
    const largeRowStrategyOptions = STRATEGIES.filter(
      ({ strategy }) => strategy !== "measureText",
    );
    const activeStrategies = isSyntheticBenchmark || isSingleVisualBenchmark
      ? STRATEGIES.filter(({ strategy }) => strategy === largeRowStrategy)
      : STRATEGIES;

    useEffect(() => {
      if (!isBenchmarkRunning) {
        return;
      }

      const completedCount = activeStrategies.filter(
        ({ strategy }) => results[strategy] != null,
      ).length;

      if (completedCount === activeStrategies.length) {
        setIsBenchmarkRunning(false);
      }
    }, [activeStrategies, isBenchmarkRunning, results]);

    const handleBenchmarkComplete = useCallback(
      (completedStrategy: WrappedRowHeightStrategy, metrics: BenchmarkMetrics) => {
        setResults((prev) => ({
          ...prev,
          [completedStrategy]: metrics,
        }));
      },
      [],
    );

    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setRows(200)}>
            200 rows
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRows(1000)}>
            1000 rows
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRows(5000)}>
            5000 rows
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRows(10000)}>
            10,000 rows
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRows(1000000)}>
            1,000,000 rows
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRows(10000000)}>
            10,000,000 rows
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIterations(20)}>
            20 iterations
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIterations(50)}>
            50 iterations
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIterations(100)}>
            100 iterations
          </Button>
          {isSyntheticBenchmark || isSingleVisualBenchmark
            ? largeRowStrategyOptions.map(({ label, strategy }) => (
                <Button
                  key={strategy}
                  size="sm"
                  variant={largeRowStrategy === strategy ? "default" : "outline"}
                  onClick={() => setLargeRowStrategy(strategy)}
                >
                  {label}
                </Button>
              ))
            : null}
          <Button
            size="sm"
            disabled={isBenchmarkRunning}
            onClick={() => {
              setResults({});
              if (isSyntheticBenchmark) {
                setResults(
                  runSyntheticSizingBenchmarkForStrategy(rows, largeRowStrategy),
                );
                setIsBenchmarkRunning(false);
                return;
              }

              setIsBenchmarkRunning(true);
              setBenchmarkRun((prev) => ({
                id: prev.id + 1,
                iterations,
                stopId: prev.stopId,
              }));
            }}
          >
            Run benchmark
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isBenchmarkRunning || isSyntheticBenchmark}
            onClick={() => {
              setIsBenchmarkRunning(false);
              setBenchmarkRun((prev) => ({
                ...prev,
                stopId: prev.stopId + 1,
              }));
            }}
          >
            Stop benchmark
          </Button>
          <div className="text-sm text-muted-foreground">
            Compare rerender cost and visual density across fixed, approximate,
            canvas-measured, and pretext-based wrapped row sizing.
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Fixture mix: short text, long paragraphs, explicit newlines, a long
          unbroken token, punctuation-heavy text, and mixed-language segmented
          text. Use larger row counts with repeated benchmark runs to make the
          strategy differences more obvious.
        </div>
        {isSyntheticBenchmark ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            Large row presets use a synthetic wrap-sizing benchmark instead of
            benchmarking the rendered table directly. Storybook still renders the
            full {rows.toLocaleString()} rows for the selected strategy while the
            benchmark measures the same row count synthetically.
          </div>
        ) : null}
        <PerformanceSummary
          rows={rows}
          iterations={iterations}
          results={results}
          summaryStrategies={activeStrategies}
        />
        {!isSyntheticBenchmark && !isSingleVisualBenchmark ? (
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
            {STRATEGIES.map(({ label, strategy }) => (
              <EditorHarness
                key={strategy}
                label={label}
                strategy={strategy}
                rows={data}
                benchmarkRun={benchmarkRun}
                onBenchmarkComplete={handleBenchmarkComplete}
              />
            ))}
          </div>
        ) : null}
        {isSingleVisualBenchmark ? (
          <div className="grid gap-4">
            {STRATEGIES.filter(({ strategy }) => strategy === largeRowStrategy).map(
              ({ label, strategy }) => (
                <EditorHarness
                  key={strategy}
                  label={label}
                  strategy={strategy}
                  rows={data}
                  benchmarkRun={benchmarkRun}
                  onBenchmarkComplete={handleBenchmarkComplete}
                />
              ),
            )}
          </div>
        ) : null}
        {isSyntheticBenchmark ? (
          <div className="grid gap-4">
            {STRATEGIES.filter(({ strategy }) => strategy === largeRowStrategy).map(
              ({ label, strategy }) => (
                <EditorHarness
                  key={strategy}
                  label={`${label} (${rows.toLocaleString()} rows)`}
                  strategy={strategy}
                  rows={data}
                  benchmarkRun={{ id: 0, iterations, stopId: 0 }}
                  onBenchmarkComplete={handleBenchmarkComplete}
                />
              ),
            )}
          </div>
        ) : null}
      </div>
    );
  },
};
