/** @typedef {{ stacker: number, level: number, plate: string, confidence: number }} StackerSlot */

const HIGH_CONFIDENCE = 0.98;
const FUZZY_MATCH_THRESHOLD = 0.72;
const PREVIOUS_PLATE_SIMILARITY_THRESHOLD = 0.5;
const STACKER_CACHE_TTL_MS = 15 * 60 * 1000;
const STACKER_COUNT = 6;
const LEVEL_COUNT = 4;

/** @type {Record<string, string[]>} */
const OCR_CONFUSABLE_GROUPS = {
  "0": ["O"],
  "1": ["I", "L"],
  "2": ["Z"],
  "5": ["S"],
  "6": ["G"],
  "8": ["B", "D"],
  B: ["8"],
  D: ["8"],
  G: ["6"],
  I: ["1"],
  L: ["1"],
  M: ["N"],
  N: ["M"],
  O: ["0"],
  S: ["5"],
  Z: ["2"],
};

/**
 * @param {string} plate
 */
export function normalizePlate(plate) {
  return plate.replace(/\s+/g, "").toUpperCase();
}

/**
 * @param {string} plate
 */
export function isVacantPlate(plate) {
  const normalized = normalizePlate(plate);
  return normalized === "EMPTY" || normalized === "UNKNOWN";
}

/**
 * @param {string} a
 * @param {string} b
 */
function ocrCharsEquivalent(a, b) {
  if (a === b) return true;
  const aAlts = OCR_CONFUSABLE_GROUPS[a] ?? [];
  const bAlts = OCR_CONFUSABLE_GROUPS[b] ?? [];
  return aAlts.includes(b) || bAlts.includes(a);
}

/**
 * @param {string} a
 * @param {string} b
 */
function levenshtein(a, b, { ocrAware = false } = {}) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const same = ocrAware
        ? ocrCharsEquivalent(a[i - 1], b[j - 1])
        : a[i - 1] === b[j - 1];
      const cost = same ? 0 : 1;
      const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = next;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * @param {string} detected
 * @param {string} known
 */
export function plateSimilarity(detected, known) {
  if (!detected || !known) return 0;
  if (detected === known) return 1;

  const maxLen = Math.max(detected.length, known.length);
  const editRatio = 1 - levenshtein(detected, known, { ocrAware: true }) / maxLen;

  let positionMatches = 0;
  const minLen = Math.min(detected.length, known.length);
  for (let i = 0; i < minLen; i++) {
    if (ocrCharsEquivalent(detected[i], known[i])) positionMatches++;
  }
  const positionRatio = minLen > 0 ? positionMatches / minLen : 0;

  let containsRatio = 0;
  if (detected.includes(known) || known.includes(detected)) {
    containsRatio = Math.min(detected.length, known.length) / maxLen;
  }

  return Math.max(editRatio, positionRatio, containsRatio);
}

/**
 * OCR misreads often share the first letter (e.g. RDN95 vs R8MS).
 * @param {string} detected
 * @param {string} reference
 */
export function platesLookLikeSameVehicle(detected, reference) {
  const normalizedDetected = normalizePlate(detected);
  const normalizedReference = normalizePlate(reference);
  if (!normalizedDetected || !normalizedReference) return false;
  if (normalizedDetected === normalizedReference) return true;
  if (normalizedDetected[0] !== normalizedReference[0]) return false;

  return plateSimilarity(normalizedDetected, normalizedReference) >=
    PREVIOUS_PLATE_SIMILARITY_THRESHOLD;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchKnownPlates(supabase) {
  const { data, error } = await supabase.from("vehicle_plates").select("plate");

  if (error) {
    console.error("[stacker-data] failed to fetch vehicle_plates:", error);
    return [];
  }

  /** @type {string[]} */
  const plates = [];
  for (const row of data ?? []) {
    const value = row?.plate;
    if (typeof value === "string" && value.trim()) {
      for (const part of value.split(/[,;\n]+/)) {
        const trimmed = part.trim();
        if (trimmed) plates.push(trimmed);
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) plates.push(item.trim());
      }
    }
  }

  return [...new Set(plates)];
}

/**
 * @param {number} stacker
 * @param {number} level
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
function logSlotDecision(stacker, level, message, details) {
  const prefix = `[stacker-data] S${stacker} L${level}`;
  if (details && Object.keys(details).length > 0) {
    console.log(`${prefix}: ${message}`, details);
  } else {
    console.log(`${prefix}: ${message}`);
  }
}

/**
 * @param {string} detected
 * @param {string[]} knownPlates
 * @param {Set<string>} usedNormalized
 * @param {{ includeBelowThreshold?: boolean }} [options]
 */
function findBestPlateMatch(detected, knownPlates, usedNormalized, options = {}) {
  const normalizedDetected = normalizePlate(detected);
  let best = null;
  /** @type {Array<{ plate: string, score: number, used: boolean }>} */
  const scored = [];

  for (const known of knownPlates) {
    const normalizedKnown = normalizePlate(known);
    const used = usedNormalized.has(normalizedKnown);

    if (normalizedKnown === normalizedDetected) {
      return {
        best: { plate: known, score: 1, method: "exact" },
        scored: [{ plate: known, score: 1, used }],
      };
    }

    const score = plateSimilarity(normalizedDetected, normalizedKnown);
    scored.push({ plate: known, score, used });
    if (!used && score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { plate: known, score, method: "fuzzy" };
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topCandidates = scored.slice(0, 5).map(({ plate, score, used }) => ({
    plate,
    score: Number(score.toFixed(3)),
    used,
  }));

  if (options.includeBelowThreshold || !best) {
    return { best, scored: topCandidates };
  }

  return { best, scored: topCandidates };
}

/**
 * @param {number} stacker
 * @param {number} level
 */
function adjacentSlots(stacker, level) {
  /** @type {Array<{ stacker: number, level: number }>} */
  const slots = [];
  if (level > 1) slots.push({ stacker, level: level - 1 });
  if (level < LEVEL_COUNT) slots.push({ stacker, level: level + 1 });
  if (stacker > 1) slots.push({ stacker: stacker - 1, level });
  if (stacker < STACKER_COUNT) slots.push({ stacker: stacker + 1, level });
  return slots;
}

/**
 * UNKNOWN detections often come from the camera seeing a neighbouring slot.
 * @param {StackerSlot} slot
 * @param {Map<string, StackerSlot>} slotByKey
 */
function looksLikeAdjacentBleed(slot, slotByKey) {
  for (const neighbour of adjacentSlots(slot.stacker, slot.level)) {
    const key = `${neighbour.stacker}:${neighbour.level}`;
    const other = slotByKey.get(key);
    if (!other || isVacantPlate(other.plate)) continue;
    if (other.confidence >= HIGH_CONFIDENCE) return true;
  }
  return false;
}

/**
 * @param {unknown} raw
 * @returns {StackerSlot[]}
 */
function parseRawCars(raw) {
  if (!raw || typeof raw !== "object") return [];

  const carsRoot = /** @type {Record<string, unknown>} */ (raw).cars;
  if (!carsRoot || typeof carsRoot !== "object") return [];

  const carsArr = /** @type {Record<string, unknown>} */ (carsRoot).cars;
  if (!Array.isArray(carsArr)) return [];

  /** @type {StackerSlot[]} */
  const slots = [];
  for (const item of carsArr) {
    if (!item || typeof item !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (item);
    const stacker = typeof record.stacker === "number" ? record.stacker : NaN;
    const level = typeof record.level === "number" ? record.level : NaN;
    const plate = typeof record.plate === "string" ? record.plate.trim() : "";
    const confidence = typeof record.confidence === "number" ? record.confidence : 0;
    if (!Number.isFinite(stacker) || !Number.isFinite(level) || !plate) continue;
    slots.push({ stacker, level, plate, confidence });
  }

  return slots;
}

/**
 * @param {StackerSlot[]} rawSlots
 * @param {string[]} knownPlates
 * @param {StackerSlot[]} [previousSlots]
 * @returns {StackerSlot[]}
 */
export function reconcileStackerSlots(rawSlots, knownPlates, previousSlots = []) {
  const knownNormalized = new Set(knownPlates.map(normalizePlate));
  const sorted = [...rawSlots].sort((a, b) => b.confidence - a.confidence);
  const rawByKey = new Map(rawSlots.map((slot) => [`${slot.stacker}:${slot.level}`, slot]));
  const previousByKey = new Map(
    previousSlots.map((slot) => [`${slot.stacker}:${slot.level}`, slot]),
  );

  console.log(
    `[stacker-data] reconciling ${rawSlots.length} slots against ${knownPlates.length} known plates (thresholds: highConfidence=${HIGH_CONFIDENCE}, fuzzy=${FUZZY_MATCH_THRESHOLD})`,
  );

  /** @type {Map<string, StackerSlot>} */
  const resolvedByKey = new Map();
  /** @type {Set<string>} */
  const usedPlates = new Set();

  for (const slot of sorted) {
    const key = `${slot.stacker}:${slot.level}`;
    const rawPlate = slot.plate.trim();
    const normalizedRaw = normalizePlate(rawPlate);
    const { stacker, level, confidence } = slot;

    if (isVacantPlate(rawPlate)) {
      if (normalizedRaw === "UNKNOWN" && looksLikeAdjacentBleed(slot, rawByKey)) {
        logSlotDecision(stacker, level, "UNKNOWN with adjacent occupied slot -> EMPTY (camera bleed)", {
          rawPlate,
          confidence,
        });
        resolvedByKey.set(key, { ...slot, plate: "EMPTY" });
        continue;
      }

      logSlotDecision(stacker, level, "sentinel plate -> EMPTY", { rawPlate, confidence });
      resolvedByKey.set(key, { ...slot, plate: "EMPTY" });
      continue;
    }

    if (slot.confidence >= HIGH_CONFIDENCE && knownNormalized.has(normalizedRaw)) {
      if (!usedPlates.has(normalizedRaw)) {
        logSlotDecision(stacker, level, "high confidence exact known match -> keep", {
          rawPlate,
          normalizedRaw,
          confidence,
        });
        usedPlates.add(normalizedRaw);
        resolvedByKey.set(key, { ...slot, plate: rawPlate });
      } else {
        logSlotDecision(stacker, level, "high confidence duplicate plate already used -> EMPTY", {
          rawPlate,
          normalizedRaw,
          confidence,
        });
        resolvedByKey.set(key, { ...slot, plate: "EMPTY", confidence: slot.confidence });
      }
      continue;
    }

    const { best: match, scored: topCandidates } = findBestPlateMatch(
      rawPlate,
      knownPlates,
      usedPlates,
      { includeBelowThreshold: true },
    );

    if (match) {
      const normalizedMatch = normalizePlate(match.plate);
      logSlotDecision(stacker, level, `fuzzy/exact match -> ${match.plate}`, {
        rawPlate,
        normalizedRaw,
        confidence,
        method: match.method,
        matchScore: Number(match.score.toFixed(3)),
        topCandidates,
      });
      usedPlates.add(normalizedMatch);
      resolvedByKey.set(key, {
        ...slot,
        plate: match.plate,
        confidence: Math.max(slot.confidence, match.score),
      });
      continue;
    }

    const previousSlot = previousByKey.get(key);
    const previousPlate = tryUsePreviousPlate(rawPlate, previousSlot, usedPlates);
    if (previousPlate) {
      const similarity = plateSimilarity(normalizedRaw, normalizePlate(previousPlate));
      logSlotDecision(stacker, level, `OCR misread similar to previous slot plate -> ${previousPlate}`, {
        rawPlate,
        previousPlate,
        confidence,
        similarity: Number(similarity.toFixed(3)),
        topCandidates,
      });
      usedPlates.add(normalizePlate(previousPlate));
      resolvedByKey.set(key, {
        ...slot,
        plate: previousPlate,
        confidence: Math.max(slot.confidence, similarity),
      });
      continue;
    }

    if (slot.confidence >= HIGH_CONFIDENCE) {
      if (!usedPlates.has(normalizedRaw)) {
        logSlotDecision(stacker, level, "high confidence unknown plate -> keep raw (not in DB)", {
          rawPlate,
          normalizedRaw,
          confidence,
          topCandidates,
        });
        usedPlates.add(normalizedRaw);
        resolvedByKey.set(key, { ...slot, plate: rawPlate });
      } else {
        logSlotDecision(stacker, level, "high confidence duplicate unknown plate -> EMPTY", {
          rawPlate,
          normalizedRaw,
          confidence,
          topCandidates,
        });
        resolvedByKey.set(key, { ...slot, plate: "EMPTY", confidence: slot.confidence });
      }
      continue;
    }

    logSlotDecision(stacker, level, "low confidence, no fuzzy match above threshold -> EMPTY", {
      rawPlate,
      normalizedRaw,
      confidence,
      fuzzyThreshold: FUZZY_MATCH_THRESHOLD,
      topCandidates,
    });
    resolvedByKey.set(key, { ...slot, plate: "EMPTY", confidence: slot.confidence });
  }

  const missingPlates = knownPlates.filter((plate) => !usedPlates.has(normalizePlate(plate)));
  if (missingPlates.length === 1) {
    for (const [key, slot] of resolvedByKey) {
      const raw = rawSlots.find((item) => `${item.stacker}:${item.level}` === key);
      if (!raw) continue;
      if (!isVacantPlate(raw.plate)) continue;
      if (normalizePlate(raw.plate) !== "UNKNOWN" && raw.confidence >= HIGH_CONFIDENCE) continue;

      logSlotDecision(slot.stacker, slot.level, `missing plate recovery -> ${missingPlates[0]}`, {
        rawPlate: raw.plate,
        confidence: raw.confidence,
        missingPlate: missingPlates[0],
      });
      resolvedByKey.set(key, {
        ...slot,
        plate: missingPlates[0],
        confidence: Math.max(slot.confidence, 0.75),
      });
      usedPlates.add(normalizePlate(missingPlates[0]));
      break;
    }
  } else if (missingPlates.length > 0) {
    console.log("[stacker-data] unassigned known plates after reconciliation:", missingPlates);
  }

  return rawSlots.map((slot) => {
    const key = `${slot.stacker}:${slot.level}`;
    const resolved = resolvedByKey.get(key) ?? { ...slot, plate: "EMPTY" };
    if (!resolvedByKey.has(key)) {
      logSlotDecision(slot.stacker, slot.level, "no resolution found -> EMPTY", {
        rawPlate: slot.plate,
        confidence: slot.confidence,
      });
    }
    return resolved;
  });
}

/**
 * When OCR is too far from any known plate, reuse the previous correct plate
 * for the same stacker slot if the reads look like the same vehicle.
 * @param {string} rawPlate
 * @param {StackerSlot | undefined} previousSlot
 * @param {Set<string>} usedPlates
 */
function tryUsePreviousPlate(rawPlate, previousSlot, usedPlates) {
  if (!previousSlot || isVacantPlate(previousSlot.plate)) return null;

  const previousPlate = previousSlot.plate.trim();
  const normalizedPrevious = normalizePlate(previousPlate);
  if (usedPlates.has(normalizedPrevious)) return null;
  if (!platesLookLikeSameVehicle(rawPlate, previousPlate)) return null;

  return previousPlate;
}

/**
 * @param {unknown} rawResponse
 * @param {string[]} knownPlates
 * @param {StackerSlot[]} [previousSlots]
 */
export function reconcileStackerResponse(rawResponse, knownPlates, previousSlots = []) {
  if (!rawResponse || typeof rawResponse !== "object") {
    return { timestamp: null, cars: { cars: [] } };
  }

  const record = /** @type {Record<string, unknown>} */ (rawResponse);
  const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;
  const rawSlots = parseRawCars(record);
  const cars = reconcileStackerSlots(rawSlots, knownPlates, previousSlots);

  return { timestamp, cars: { cars } };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<{ timestamp: string | null, cars: { cars: StackerSlot[] } } | null>}
 */
async function fetchLatestStackerCacheRow(supabase) {
  const { data, error } = await supabase
    .from("stacker_data")
    .select("id, created_at, data")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[stacker-data] failed to fetch stacker_data cache:", error);
    return null;
  }

  return data;
}

/**
 * @param {string} data
 * @returns {{ timestamp: string | null, cars: { cars: StackerSlot[] } } | null}
 */
function parseCachedStackerResponse(data) {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : null,
      cars: {
        cars: parseRawCars(parsed),
      },
    };
  } catch (error) {
    console.error("[stacker-data] failed to parse cached stacker_data:", error);
    return null;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ timestamp: string | null, cars: { cars: StackerSlot[] } }} response
 */
async function storeStackerCache(supabase, response) {
  const { data: inserted, error: insertError } = await supabase
    .from("stacker_data")
    .insert({ data: JSON.stringify(response) })
    .select("id")
    .single();

  if (insertError) {
    console.error("[stacker-data] failed to store stacker_data cache:", insertError);
    return;
  }

  if (!inserted?.id) return;

  const { error: deleteError } = await supabase
    .from("stacker_data")
    .delete()
    .not("id", "eq", inserted.id);

  if (deleteError) {
    console.error("[stacker-data] failed to prune older stacker_data rows:", deleteError);
  }
}

/**
 * Returns cached stacker data when fresh (<15m), otherwise fetches Cloudflare,
 * reconciles plates, stores the result, and returns it.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchStackerData(supabase) {
  const emptyResponse = { timestamp: null, cars: { cars: [] } };
  const cachedRow = await fetchLatestStackerCacheRow(supabase);

  if (cachedRow) {
    const ageMs = Date.now() - new Date(cachedRow.created_at).getTime();
    if (ageMs <= STACKER_CACHE_TTL_MS) {
      const cached = parseCachedStackerResponse(cachedRow.data);
      if (cached) {
        console.log(
          `[stacker-data] serving cached stacker data age=${Math.round(ageMs / 1000)}s id=${cachedRow.id}`,
        );
        return cached;
      }
    }
  }

  if (!process.env.CLOUDFLARE_API_URL) {
    console.log("[stacker-data] CLOUDFLARE_API_URL not set, skipping stacker fetch.");
    return emptyResponse;
  }

  const rawUrl = process.env.CLOUDFLARE_API_URL.trim();
  const cloudflareUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  const cloudflareFetch = await fetch(cloudflareUrl, {
    method: "GET",
    headers: {
      "X-API-Key": process.env.CLOUDFLARE_API_KEY ?? "",
    },
  });

  if (!cloudflareFetch.ok) {
    console.error(
      `[stacker-data] cloudflare fetch failed status=${cloudflareFetch.status}`,
    );
    return emptyResponse;
  }

  const rawCloudflare = await cloudflareFetch.json();
  const knownPlates = await fetchKnownPlates(supabase);
  const previousSlots = cachedRow ? (parseCachedStackerResponse(cachedRow.data)?.cars.cars ?? []) : [];
  const response = reconcileStackerResponse(rawCloudflare, knownPlates, previousSlots);

  await storeStackerCache(supabase, response);

  console.log(
    `[stacker-data] fetched fresh cloudflare data timestamp=${response.timestamp} cars=${response.cars.cars.length} knownPlates=${knownPlates.length}`,
  );

  return response;
}
