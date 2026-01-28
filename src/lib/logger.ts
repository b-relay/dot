import { configure, getConsoleSink, getLogger as getLogTapeLogger, getStreamSink, getJsonLinesFormatter, reset } from "@logtape/logtape";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Writable } from "node:stream";

let currentDotfilesPath: string | null = null;

export async function configureLogging(dotfilesPath: string): Promise<void> {
  // If already configured for this path, skip
  if (currentDotfilesPath === dotfilesPath) return;

  // Reset LogTape if reconfiguring for a different path
  if (currentDotfilesPath !== null) {
    await reset();
  }

  // Ensure dotfiles directory exists
  await mkdir(dotfilesPath, { recursive: true });

  // Create write stream for JSON Lines logs
  const logFilePath = `${dotfilesPath}/.dot-operations.jsonl`;
  const fileStream = createWriteStream(logFilePath, { flags: "a" });
  const webStream = Writable.toWeb(fileStream);

  await configure({
    sinks: {
      console: getConsoleSink(),
      file: getStreamSink(webStream, {
        formatter: getJsonLinesFormatter()
      })
    },
    loggers: [
      { category: ["dot"], lowestLevel: "info", sinks: ["console", "file"] }
    ]
  });

  currentDotfilesPath = dotfilesPath;
}

export function getLogger(category: string[]): ReturnType<typeof getLogTapeLogger> {
  return getLogTapeLogger(["dot", ...category]);
}
