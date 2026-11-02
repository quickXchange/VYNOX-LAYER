import { createHash } from "node:crypto";
import { mkdir, open, lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { developmentSupabaseAuth } from "../supabase-auth/config";

export const CAPTURE_MARKER = "Captured by Development mail sink; not externally delivered.";

export function developmentMailCapture() {
  if (process.env.QXLAYER_DEVELOPMENT_MAIL_CAPTURE !== "true") return false;
  if (process.env.NODE_ENV !== "development" ||
      process.env.QXLAYER_EXTERNAL_ENVIRONMENT === "production" || !developmentSupabaseAuth())
    throw new Error("Development mail capture refused outside pinned Development.");
  return true;
}

// Private receipt only: no recipient address, message body, authentication code,
// or credential is retained. A capture is not evidence of external delivery.
export async function captureDevelopmentMail(eventId: string, payload: object) {
  if (!developmentMailCapture()) throw new Error("Development capture is disabled.");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(eventId)) throw new Error("Invalid capture event.");
  const directory = resolve(".local/development-mail-capture");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700)
    throw new Error("Private capture directory required.");
  const payloadSha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const path = resolve(directory, `${eventId}.json`);
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ eventId, payloadSha256, capturedAt: new Date().toISOString(),
        externallyDelivered: false }));
      await file.sync();
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(path, "utf8"));
    if (previous.payloadSha256 !== payloadSha256) throw new Error("Capture idempotency conflict.");
  }
}
