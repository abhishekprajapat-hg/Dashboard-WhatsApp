export function parseKeywords(value = "") {
  return String(value || "")
    .split(/[,/|;\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
}

export function formatKeywords(keywords = []) {
  return parseKeywords(Array.isArray(keywords) ? keywords.join(",") : keywords).join(", ");
}

export function keywordMatches(body = "", keywords = []) {
  const inboundBody = String(body || "").toLowerCase();
  return parseKeywords(Array.isArray(keywords) ? keywords.join(",") : keywords).some((keyword) => inboundBody.includes(keyword));
}
