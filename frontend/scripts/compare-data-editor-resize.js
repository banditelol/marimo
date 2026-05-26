/* Copyright 2026 Marimo. All rights reserved. */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const STORY_PATH =
  "/?path=/story/dataeditor-resizecomparison--approx-vs-incremental-resize";
const DEFAULT_STORYBOOK_URL = "http://127.0.0.1:6006";
const DRAG_DELTA_X = -180;
const DRAG_STEPS = 12;

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function getMarkerCenter(page, testId) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) {
    throw new Error(`Could not resolve bounding box for ${testId}`);
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function dragFromMarker(page, markerTestId, deltaX, baseName, outputDir) {
  const start = await getMarkerCenter(page, markerTestId);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();

  const midX = start.x + deltaX / 2;
  const endX = start.x + deltaX;

  await page.mouse.move(midX, start.y, {
    steps: Math.max(1, Math.floor(DRAG_STEPS / 2)),
  });
  await page.screenshot({
    path: path.join(outputDir, `${baseName}-mid-drag.png`),
    fullPage: true,
  });

  await page.mouse.move(endX, start.y, {
    steps: Math.max(1, Math.ceil(DRAG_STEPS / 2)),
  });
  await page.mouse.up();

  await page.screenshot({
    path: path.join(outputDir, `${baseName}-after-release.png`),
    fullPage: true,
  });

  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(outputDir, `${baseName}-settled.png`),
    fullPage: true,
  });
}

async function run() {
  const baseUrl = process.env.STORYBOOK_URL ?? DEFAULT_STORYBOOK_URL;
  const outputDir = path.resolve(
    process.cwd(),
    process.env.PLAYWRIGHT_OUTPUT_DIR ??
      `playwright-artifacts/data-editor-resize-comparison/${timestamp()}`,
  );
  const shouldRecordVideo = process.env.RECORD_VIDEO === "1";
  const videoDir = path.join(outputDir, "video");

  await ensureDir(outputDir);
  if (shouldRecordVideo) {
    await ensureDir(videoDir);
  }

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });
  const context = await browser.newContext({
    viewport: { width: 1800, height: 1200 },
    recordVideo: shouldRecordVideo
      ? {
          dir: videoDir,
          size: { width: 1800, height: 1200 },
        }
      : undefined,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}${STORY_PATH}`, { waitUntil: "networkidle" });
    await page.getByTestId("approx-panel").waitFor();
    await page.getByTestId("approx-incremental-panel").waitFor();
    await page.getByTestId("approx-incremental-baseline-panel").waitFor();

    await page.screenshot({
      path: path.join(outputDir, "baseline.png"),
      fullPage: true,
    });

    await dragFromMarker(
      page,
      "approx-notes-resize-target",
      DRAG_DELTA_X,
      "approx",
      outputDir,
    );

    await page.goto(`${baseUrl}${STORY_PATH}`, { waitUntil: "networkidle" });
    await page.getByTestId("approx-panel").waitFor();
    await page.getByTestId("approx-incremental-panel").waitFor();
    await page.getByTestId("approx-incremental-baseline-panel").waitFor();

    await dragFromMarker(
      page,
      "approx-incremental-notes-resize-target",
      DRAG_DELTA_X,
      "approx-incremental",
      outputDir,
    );

    await page.goto(`${baseUrl}${STORY_PATH}`, { waitUntil: "networkidle" });
    await page.getByTestId("approx-panel").waitFor();
    await page.getByTestId("approx-incremental-panel").waitFor();
    await page.getByTestId("approx-incremental-baseline-panel").waitFor();

    await dragFromMarker(
      page,
      "approx-incremental-baseline-notes-resize-target",
      DRAG_DELTA_X,
      "approx-incremental-baseline",
      outputDir,
    );

    const summary = {
      story: `${baseUrl}${STORY_PATH}`,
      outputDir,
      artifacts: [
        "baseline.png",
        "approx-mid-drag.png",
        "approx-after-release.png",
        "approx-settled.png",
        "approx-incremental-mid-drag.png",
        "approx-incremental-after-release.png",
        "approx-incremental-settled.png",
        "approx-incremental-baseline-mid-drag.png",
        "approx-incremental-baseline-after-release.png",
        "approx-incremental-baseline-settled.png",
      ],
    };

    await fs.writeFile(
      path.join(outputDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );

    console.log(`Wrote resize comparison artifacts to ${outputDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
