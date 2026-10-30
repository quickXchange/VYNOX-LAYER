import express, { type RequestHandler } from "express";

// Browser/API clients send ordinary JSON/forms, not compressed request bodies.
// Reject encodings before a decompression stream can consume attacker input.
export const jsonBody = express.json({ limit: "128kb", inflate: false });
const formOptions = {
  extended: true, limit: "128kb", inflate: false, parameterLimit: 1000, depth: 16,
};
export const formBody = express.urlencoded(formOptions);

export function bodyWithinBudget(body: unknown): boolean {
  const pending = [{ value: body, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++visited > 20_000 || depth > 64) return false;
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
    }
  }
  return true;
}

// Bound validation work before schema validators construct per-element errors.
export const requestBodyBudget: RequestHandler = (req, res, next) => {
  if (!bodyWithinBudget(req.body)) {
    res.status(413).json({ error: "Request structure exceeds its allowed complexity." });
    return;
  }
  next();
};
