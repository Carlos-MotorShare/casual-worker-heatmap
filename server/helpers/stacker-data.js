const STACKER_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * @typedef {"occupied" | "likely-empty" | "review"} StackerStatus
 * @typedef {"HIGH" | "MEDIUM" | "LOW"} StackerConfidence
 *
 * @typedef {{
 *   spaceId: string,
 *   stacker: number,
 *   level: number,
 *   status: StackerStatus,
 *   confidence: StackerConfidence,
 *   vehicleId: string | null,
 *   similarity: number | null,
 * }} StackerSpace
 *
 * @typedef {{
 *   generatedAt: string | null,
 *   snapshotSource: string | null,
 *   model: { name: string | null, dimensions: number | null } | null,
 *   fleet: { vehicleCount: number | null } | null,
 *   thresholds: Record<string, number>,
 *   summary: {
 *     occupiedSpaces: number,
 *     firstChoiceAssignments: number,
 *     fallbackAssignments: number,
 *     likelyEmptySpaces: number,
 *     reviewSpaces: number,
 *   },
 *   backendView: {
 *     occupiedSpaces: StackerSpace[],
 *     emptySpaces: StackerSpace[],
 *     reviewSpaces: StackerSpace[],
 *   },
 * }} StackerResponse
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 */
function parseNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 */
function parseString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {StackerConfidence}
 */
function parseConfidence(value) {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "LOW";
}

/**
 * @param {unknown} value
 * @returns {StackerStatus}
 */
function parseStatus(value) {
  return value === "occupied" || value === "likely-empty" || value === "review"
    ? value
    : "review";
}

/**
 * @param {unknown} item
 * @returns {StackerSpace | null}
 */
function parseSpace(item) {
  if (!isRecord(item)) return null;

  const stacker = parseNumber(item.stacker);
  const level = parseNumber(item.level);
  const spaceId = parseString(item.spaceId);

  if (stacker === null || level === null || !spaceId) return null;

  return {
    spaceId,
    stacker,
    level,
    status: parseStatus(item.status),
    confidence: parseConfidence(item.confidence),
    vehicleId: parseString(item.vehicleId),
    similarity: parseNumber(item.similarity),
  };
}

/**
 * @param {unknown} value
 * @returns {StackerSpace[]}
 */
function parseSpaces(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => parseSpace(item))
    .filter((item) => item !== null)
    .sort((a, b) => a.stacker - b.stacker || a.level - b.level);
}

/**
 * @param {unknown} rawResponse
 * @returns {StackerResponse}
 */
export function reconcileStackerResponse(rawResponse) {
  if (!isRecord(rawResponse)) {
    return {
      generatedAt: null,
      snapshotSource: null,
      model: null,
      fleet: null,
      thresholds: {},
      summary: {
        occupiedSpaces: 0,
        firstChoiceAssignments: 0,
        fallbackAssignments: 0,
        likelyEmptySpaces: 0,
        reviewSpaces: 0,
      },
      backendView: {
        occupiedSpaces: [],
        emptySpaces: [],
        reviewSpaces: [],
      },
    };
  }

  const backendView = isRecord(rawResponse.backendView) ? rawResponse.backendView : {};
  const occupiedSpaces = parseSpaces(backendView.occupiedSpaces);
  const emptySpaces = parseSpaces(backendView.emptySpaces);
  const reviewSpaces = parseSpaces(backendView.reviewSpaces);
  const summary = isRecord(rawResponse.summary) ? rawResponse.summary : {};
  const model = isRecord(rawResponse.model) ? rawResponse.model : null;
  const fleet = isRecord(rawResponse.fleet) ? rawResponse.fleet : null;
  const thresholds = isRecord(rawResponse.thresholds) ? rawResponse.thresholds : {};

  return {
    generatedAt: parseString(rawResponse.generatedAt),
    snapshotSource: parseString(rawResponse.snapshotSource),
    model: model
      ? {
          name: parseString(model.name),
          dimensions: parseNumber(model.dimensions),
        }
      : null,
    fleet: fleet
      ? {
          vehicleCount: parseNumber(fleet.vehicleCount),
        }
      : null,
    thresholds: Object.fromEntries(
      Object.entries(thresholds).filter(([, value]) => typeof value === "number"),
    ),
    summary: {
      occupiedSpaces: parseNumber(summary.occupiedSpaces) ?? occupiedSpaces.length,
      firstChoiceAssignments: parseNumber(summary.firstChoiceAssignments) ?? 0,
      fallbackAssignments: parseNumber(summary.fallbackAssignments) ?? 0,
      likelyEmptySpaces: parseNumber(summary.likelyEmptySpaces) ?? emptySpaces.length,
      reviewSpaces: parseNumber(summary.reviewSpaces) ?? reviewSpaces.length,
    },
    backendView: {
      occupiedSpaces,
      emptySpaces,
      reviewSpaces,
    },
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<{ id: string, created_at: string, data: string } | null>}
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
 * @returns {StackerResponse | null}
 */
function parseCachedStackerResponse(data) {
  try {
    return reconcileStackerResponse(JSON.parse(data));
  } catch (error) {
    console.error("[stacker-data] failed to parse cached stacker_data:", error);
    return null;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {StackerResponse} response
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
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<StackerResponse>}
 */
export async function fetchStackerData(supabase) {
  const emptyResponse = reconcileStackerResponse(null);
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
    console.error(`[stacker-data] cloudflare fetch failed status=${cloudflareFetch.status}`);
    return emptyResponse;
  }

  const rawCloudflare = await cloudflareFetch.json();
  const response = reconcileStackerResponse(rawCloudflare);

  await storeStackerCache(supabase, response);

  console.log(
    `[stacker-data] fetched fresh cloudflare data generatedAt=${response.generatedAt} occupied=${response.summary.occupiedSpaces} empty=${response.summary.likelyEmptySpaces} review=${response.summary.reviewSpaces}`,
  );

  return response;
}
