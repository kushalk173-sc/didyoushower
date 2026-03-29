"use strict";

let fileHandle = null;
let fileSize = 0;
const enc = new TextEncoder();

self.addEventListener("message", async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === "open") {
      const root = await navigator.storage.getDirectory();
      fileHandle = await root.getFileHandle("hydration-audit.ndjson", { create: true });
      const file = await fileHandle.getFile();
      fileSize = file.size;
      self.postMessage({ id, result: { opened: true, existingBytes: fileSize } });
      return;
    }

    if (type === "append") {
      if (!fileHandle) throw new Error("not open");
      const line = enc.encode(JSON.stringify(payload) + "\n");
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek(fileSize);
      await writable.write(line);
      await writable.close();
      fileSize += line.byteLength;
      self.postMessage({ id, result: { written: line.byteLength, total: fileSize } });
      return;
    }

    if (type === "read-all") {
      if (!fileHandle) throw new Error("not open");
      const file = await fileHandle.getFile();
      const text = await file.text();
      const records = text
        .split("\n")
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      self.postMessage({ id, result: { records, count: records.length } });
      return;
    }

    self.postMessage({ id, error: "unknown message type: " + type });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
