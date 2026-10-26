import { HttpError } from "../../lib/errors";

/** Only server-persisted submission/approved-quotation snapshots are agreements. */
export function orderAgreement(row: any) {
  const selection = row.status === "quote_ready" ? row.approved_configuration : row.configuration?.catalogSnapshot;
  if (!selection?.plan || !Array.isArray(selection.addons))
    throw new HttpError(409, "This order needs an approved quotation before invoicing; its original pricing snapshot is missing.");
  return selection;
}
