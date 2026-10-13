/**
 * Links that open the user's ChatGPT / Gemini app. Mode only prepares text
 * and files — it never automates either site (OpenAI's terms forbid
 * programmatic extraction), so these links just open a tab.
 *
 * ChatGPT: the (undocumented) `https://chatgpt.com/?prompt=…` link prefills
 * the composer; since mid-2025 OpenAI only auto-sends for same-site links, so
 * opened from Mode it prefills WITHOUT sending — the user pastes the photo
 * and presses Enter. `temporary-chat=true` keeps hand-offs out of history.
 * Gemini has no prefill link: open the app and paste the prompt.
 */

export const CHATGPT_URL = 'https://chatgpt.com/';

/** https://gemini.google.com/app (Gemini has no prompt prefill link). */
export const GEMINI_APP_URL = 'https://gemini.google.com/app';

/** Longest prompt we put in a URL (the prefill is unreliable beyond ~2,000 characters). */
export const MAX_DEEPLINK_PROMPT_CHARS = 2000;
/** Longest URL we hand to window.open (well under common server / proxy limits). */
export const MAX_DEEPLINK_URL_CHARS = 8000;

/**
 * https://chatgpt.com/?prompt=… (prefills without sending when opened from
 * another site); null when the prompt is empty or too long for a URL.
 */
export function chatgptDeepLink(prompt: string, opts: { temporary?: boolean } = {}): string | null {
  const text = prompt.replace(/\r\n?/g, '\n').trim();
  if (!text || text.length > MAX_DEEPLINK_PROMPT_CHARS) return null;
  const params = [`prompt=${encodeURIComponent(text)}`];
  if (opts.temporary) params.push('temporary-chat=true');
  const url = `${CHATGPT_URL}?${params.join('&')}`;
  return url.length > MAX_DEEPLINK_URL_CHARS ? null : url;
}
