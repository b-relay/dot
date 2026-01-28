import { configure, getConsoleSink, getLogger as getLogTapeLogger, getStreamSink, getJsonLinesFormatter } from "@logtape/logtape";
import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";

let configured = false;

export async function configureLogging(dotfilesPath: string): Promise<void> {
  if (configured) return;

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

  configured = true;
}

export function getLogger(category: string[]): ReturnType<typeof getLogTapeLogger> {
  return getLogTapeLogger(["dot", ...category]);
}
