self.addEventListener("message", (event) => {
  const data = event.data || {};

  try {
    if (data.type === "evaluate") {
      self.postMessage({
        id: data.id,
        result: evaluatePayload(data.payload || {}),
      });
      return;
    }

    if (data.type === "replay") {
      self.postMessage({
        id: data.id,
        result: replayLedger(data.payload || {}),
      });
      return;
    }

    if (data.type === "mineBlock") {
      self.postMessage({
        id: data.id,
        result: mineBlock(data.payload || {}),
      });
      return;
    }

    self.postMessage({
      id: data.id,
      error: "Unknown worker message type",
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

function evaluatePayload(payload) {
  const peerFactor = Math.min(0.14, (payload.peerCount || 1) * 0.02);
  const hesitation = Math.min(1, (payload.hesitationMs || 0) / 8000);
  const vector = [0, 1, 2, 3].map((index) =>
    round4(normalizedNoise(`${payload.seed}|${payload.nodeId}|${payload.verdict}`, index))
  );
  const spectrum = (vector[0] + vector[1] * 0.9 + vector[2] * 1.1 + vector[3] * 0.7) / 3.7;
  const baseline = payload.verdict === "dry" ? 0.58 : 0.14;
  const dryScore = clamp(baseline + spectrum * 0.18 + hesitation * 0.07 + peerFactor, 0.01, 0.99);
  const confidence = Math.round(clamp(0.55 + Math.abs(dryScore - 0.5), 0.51, 0.99) * 100);

  return {
    dryScore: round6(dryScore),
    confidence,
    bucket: dryScore >= 0.36 ? "dry" : "wet",
    vector,
    entropy: round6(vector[0] * vector[3]),
    phase: `mesh-${Math.floor(vector[1] * 10)}-${Math.floor(vector[2] * 10)}`,
  };
}

function replayLedger(payload) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  const counts = {};
  let accumulator = 0;

  events.forEach((event, index) => {
    counts[event.type] = (counts[event.type] || 0) + 1;
    accumulator += hashString(`${event.hash || event.id || "event"}|${index}`) % 997;
  });

  const entropy = events.length ? accumulator / events.length / 997 : 0;
  const dominantType = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const digest = simpleDigest(JSON.stringify({ counts, accumulator, total: events.length }));

  return {
    count: events.length,
    entropy: round6(entropy),
    verdict:
      entropy > 0.47
        ? "Ledger drift is within dry tolerance"
        : "Ledger smells damp but remains internally consistent",
    dominantType: dominantType ? dominantType[0] : "none",
    digest,
  };
}

function mineBlock(payload) {
  const block = {
    index: payload.index || 0,
    ts: new Date().toISOString(),
    prevHash: payload.prevHash || "0".repeat(64),
    difficulty: Math.max(1, Math.min(5, payload.difficulty || 3)),
    nonce: 0,
    miner: payload.miner || "drychain-worker",
    payload: payload.payload || {},
  };

  const prefix = "0".repeat(block.difficulty);
  let hash = computeBlockHash(block);

  while (!hash.startsWith(prefix)) {
    block.nonce += 1;
    hash = computeBlockHash(block);
  }

  block.hash = hash;
  return block;
}

function computeBlockHash(block) {
  return toyHash(
    canonicalize({
      index: block.index,
      ts: block.ts,
      prevHash: block.prevHash,
      difficulty: block.difficulty,
      nonce: block.nonce,
      miner: block.miner,
      payload: block.payload,
    })
  );
}

function toyHash(value) {
  let out = "";
  for (let seed = 0; seed < 8; seed += 1) {
    out += hash32(value + "|" + seed).toString(16).padStart(8, "0");
  }
  return out;
}

function canonicalize(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((item) => canonicalize(item)).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalize(value[key])).join(",") + "}";
}

function simpleDigest(value) {
  return "wrk-" + Math.abs(hashString(value)).toString(16).padStart(8, "0");
}

function normalizedNoise(seed, index) {
  const hash = hashString(`${seed}|${index}`);
  return (hash % 10000) / 10000;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round4(value) {
  return Number(value.toFixed(4));
}

function round6(value) {
  return Number(value.toFixed(6));
}
