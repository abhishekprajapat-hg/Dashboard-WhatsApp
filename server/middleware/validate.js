function formatIssues(error) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function respondInvalid(res, error) {
  const details = formatIssues(error);
  const first = details[0];
  return res.status(400).json({
    error: "VALIDATION_ERROR",
    message: first ? `${first.path || "request"}: ${first.message}` : "Invalid request.",
    details,
  });
}

// Validates req.body against a Zod schema and replaces it with the parsed (and defaulted/coerced)
// result, so downstream handlers see clean, typed data instead of re-deriving it from raw input.
export function validateBody(schema) {
  return (req, res, next) => {
    // express.json() leaves req.body as undefined (not {}) when a request has no body or the
    // wrong content-type - every hand-rolled route in this codebase defends against that with
    // `req.body || {}`, so the shared middleware does the same rather than rejecting those requests.
    const result = schema.safeParse(req.body || {});
    if (!result.success) return respondInvalid(res, result.error);
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return respondInvalid(res, result.error);
    req.query = result.data;
    next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return respondInvalid(res, result.error);
    req.params = result.data;
    next();
  };
}
