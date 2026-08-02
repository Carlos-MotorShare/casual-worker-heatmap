/** @typedef {{ stacker: number, level: number, plate: string, confidence: number }} StackerSlot */

const HIGH_CONFIDENCE = 0.98;
const FUZZY_MATCH_THRESHOLD = 0.72;
const STACKER_COUNT = 6;
const LEVEL_COUNT = 4;

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
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
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
function plateSimilarity(detected, known) {
  if (!detected || !known) return 0;
  if (detected === known) return 1;

  const maxLen = Math.max(detected.length, known.length);
  const editRatio = 1 - levenshtein(detected, known) / maxLen;

  let positionMatches = 0;
  const minLen = Math.min(detected.length, known.length);
  for (let i = 0; i < minLen; i++) {
    if (detected[i] === known[i]) positionMatches++;
  }
  const positionRatio = minLen > 0 ? positionMatches / minLen : 0;

  let containsRatio = 0;
  if (detected.includes(known) || known.includes(detected)) {
    containsRatio = Math.min(detected.length, known.length) / maxLen;
  }

  return Math.max(editRatio, positionRatio, containsRatio);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchKnownPlates(supabase) {
  const { data, error } = await supabase.from("vehicle_plates").select("plates");

  if (error) {
    console.error("[stacker-data] failed to fetch vehicle_plates:", error);
    return [];
  }

  /** @type {string[]} */
  const plates = [];
  for (const row of data ?? []) {
    const value = row?.plates;
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
 * @param {string} detected
 * @param {string[]} knownPlates
 * @param {Set<string>} usedNormalized
 */
function findBestPlateMatch(detected, knownPlates, usedNormalized) {
  const normalizedDetected = normalizePlate(detected);
  let best = null;

  for (const known of knownPlates) {
    const normalizedKnown = normalizePlate(known);
    if (usedNormalized.has(normalizedKnown)) continue;

    if (normalizedKnown === normalizedDetected) {
      return { plate: known, score: 1, method: "exact" };
    }

    const score = plateSimilarity(normalizedDetected, normalizedKnown);
    if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { plate: known, score, method: "fuzzy" };
    }
  }

  return best;
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
 * @returns {StackerSlot[]}
 */
export function reconcileStackerSlots(rawSlots, knownPlates) {
  const knownNormalized = new Set(knownPlates.map(normalizePlate));
  const sorted = [...rawSlots].sort((a, b) => b.confidence - a.confidence);
  const rawByKey = new Map(rawSlots.map((slot) => [`${slot.stacker}:${slot.level}`, slot]));

  /** @type {Map<string, StackerSlot>} */
  const resolvedByKey = new Map();
  /** @type {Set<string>} */
  const usedPlates = new Set();

  for (const slot of sorted) {
    const key = `${slot.stacker}:${slot.level}`;
    const rawPlate = slot.plate.trim();
    const normalizedRaw = normalizePlate(rawPlate);

    if (isVacantPlate(rawPlate)) {
      if (normalizedRaw === "UNKNOWN" && looksLikeAdjacentBleed(slot, rawByKey)) {
        resolvedByKey.set(key, { ...slot, plate: "EMPTY" });
        continue;
      }

      resolvedByKey.set(key, { ...slot, plate: "EMPTY" });
      continue;
    }

    if (slot.confidence >= HIGH_CONFIDENCE && knownNormalized.has(normalizedRaw)) {
      if (!usedPlates.has(normalizedRaw)) {
        usedPlates.add(normalizedRaw);
        resolvedByKey.set(key, { ...slot, plate: rawPlate });
      } else {
        resolvedByKey.set(key, { ...slot, plate: "EMPTY", confidence: slot.confidence });
      }
      continue;
    }

    const match = findBestPlateMatch(rawPlate, knownPlates, usedPlates);
    if (match) {
      const normalizedMatch = normalizePlate(match.plate);
      usedPlates.add(normalizedMatch);
      resolvedByKey.set(key, {
        ...slot,
        plate: match.plate,
        confidence: Math.max(slot.confidence, match.score),
      });
      continue;
    }

    if (slot.confidence >= HIGH_CONFIDENCE) {
      if (!usedPlates.has(normalizedRaw)) {
        usedPlates.add(normalizedRaw);
        resolvedByKey.set(key, { ...slot, plate: rawPlate });
      } else {
        resolvedByKey.set(key, { ...slot, plate: "EMPTY", confidence: slot.confidence });
      }
      continue;
    }

    resolvedByKey.set(key, { ...slot, plate: "EMPTY", confidence: slot.confidence });
  }

  const missingPlates = knownPlates.filter((plate) => !usedPlates.has(normalizePlate(plate)));
  if (missingPlates.length === 1) {
    for (const [key, slot] of resolvedByKey) {
      const raw = rawSlots.find((item) => `${item.stacker}:${item.level}` === key);
      if (!raw) continue;
      if (!isVacantPlate(raw.plate)) continue;
      if (normalizePlate(raw.plate) !== "UNKNOWN" && raw.confidence >= HIGH_CONFIDENCE) continue;

      resolvedByKey.set(key, {
        ...slot,
        plate: missingPlates[0],
        confidence: Math.max(slot.confidence, 0.75),
      });
      usedPlates.add(normalizePlate(missingPlates[0]));
      break;
    }
  }

  return rawSlots.map((slot) => {
    const key = `${slot.stacker}:${slot.level}`;
    return resolvedByKey.get(key) ?? { ...slot, plate: "EMPTY" };
  });
}

/**
 * @param {unknown} rawResponse
 * @param {string[]} knownPlates
 */
export function reconcileStackerResponse(rawResponse, knownPlates) {
  if (!rawResponse || typeof rawResponse !== "object") {
    return { timestamp: null, cars: { cars: [] } };
  }

  const record = /** @type {Record<string, unknown>} */ (rawResponse);
  const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;
  const rawSlots = parseRawCars(record);
  const cars = reconcileStackerSlots(rawSlots, knownPlates);

  return { timestamp, cars: { cars } };
}
