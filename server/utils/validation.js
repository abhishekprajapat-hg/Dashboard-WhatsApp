export function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim().toLowerCase());
}

export function passwordPolicy(password = "") {
  const text = String(password);
  const errors = [];
  if (text.length < 10) errors.push("at least 10 characters");
  if (!/[a-z]/.test(text)) errors.push("one lowercase letter");
  if (!/[A-Z]/.test(text)) errors.push("one uppercase letter");
  if (!/[0-9]/.test(text)) errors.push("one number");
  return {
    valid: errors.length === 0,
    errors,
    message: errors.length ? `Password must contain ${errors.join(", ")}.` : "",
  };
}

export function requiredString(value = "", max = 200) {
  return String(value || "").trim().slice(0, max);
}
