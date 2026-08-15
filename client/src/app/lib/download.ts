import { getStoredToken } from "./api";

// A plain <a href> can't carry the Authorization header these routes require (they sit behind
// requireAuth), so this does a real authenticated fetch, turns the response into a blob, then
// triggers the browser's normal save-file flow via a throwaway anchor element.
export function downloadFromUrl(url: string, filename: string) {
  const token = getStoredToken();
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((response) => response.blob())
    .then((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    })
    .catch(() => undefined);
}
