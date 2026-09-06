/**
 * Copy plain text without assuming the async Clipboard API is available.
 *
 * Electron, browser permission settings, and file-like contexts can all make
 * navigator.clipboard unavailable. The bounded textarea fallback keeps room
 * codes and Drive share links usable without exposing anything else.
 */
export async function copyPlainText(value: string): Promise<boolean> {
  if (value === '') {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based compatibility path.
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
