/**
 * Unified Slack notification wrapper.
 *
 * Channels:
 *   'auto'  → SLACK_WEBHOOK_URL_AUTO  (scheduled Friday summary)
 *   'alert' → SLACK_WEBHOOK_URL_ALERT (extra-hands urgent alerts)
 *
 * @param {'auto'|'alert'} channel
 * @param {{ text: string, blocks?: unknown[] }} payload
 */
export async function sendSlackNotification(channel, { text, blocks }) {
  const envKey = channel === 'alert' ? 'SLACK_WEBHOOK_URL_ALERT' : 'SLACK_WEBHOOK_URL_AUTO'
  const webhookUrl = process.env[envKey]

  if (!webhookUrl) {
    console.error(`[slack] Missing ${envKey} — notification skipped`)
    return
  }

  const body = /** @type {Record<string, unknown>} */ ({ text })
  if (blocks?.length) body.blocks = blocks

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error(`[slack] ${channel} webhook returned HTTP ${res.status}`)
    } else {
      console.log(`[slack] ${channel} notification sent`)
    }
  } catch (err) {
    console.error(`[slack] ${channel} webhook fetch failed:`, err)
  }
}

// ── Username → Slack ID mapping ──────────────────────────────────────────────

/** Lowercase username → Slack member ID */
const SLACK_IDS = {
  carlos: 'U09CM27LZDL',
  james:  'U06NJ9ZUEN4',
  hugo:   'U07RLKWD8QM',
  joe:    'U06NJA5RLFJ',
  cole:   'U06MVGHQNM8',
}

/**
 * Returns a Slack mention if the username is known, otherwise the plain username.
 * @param {string} username
 * @returns {string}
 */
export function slackMention(username) {
  const id = SLACK_IDS[username.trim().toLowerCase()]
  return id ? `<@${id}>` : username
}

// ── Block Kit helpers ────────────────────────────────────────────────────────

/** @param {string} text */
export function headerBlock(text) {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } }
}

/** @param {string} mrkdwn */
export function sectionBlock(mrkdwn) {
  return { type: 'section', text: { type: 'mrkdwn', text: mrkdwn } }
}

/** @param {string[]} mrkdwnLines */
export function contextBlock(mrkdwnLines) {
  return {
    type: 'context',
    elements: mrkdwnLines.map((t) => ({ type: 'mrkdwn', text: t })),
  }
}

export const dividerBlock = { type: 'divider' }
