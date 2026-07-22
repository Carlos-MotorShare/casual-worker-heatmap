import { supabase } from "../supabase.js";

export function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * @param {string} userId
 * @returns {Promise<{ admin: boolean, canRoster: boolean } | null>}
 */
export async function getUserFlags(userId) {
  const { data, error } = await supabase.rpc("get_user_flags", { p_user_id: userId });
  if (error) {
    console.error("[users] get_user_flags failed:", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (row);
  return {
    admin: record.admin === true,
    canRoster: record.can_roster === true,
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePgTimeString(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{2}):(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}:${match[3]}`;
  }
  return String(value);
}

/**
 * Normalize Supabase date/date-like values to YYYY-MM-DD for frontend keying.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePgDateString(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return String(value);
}
