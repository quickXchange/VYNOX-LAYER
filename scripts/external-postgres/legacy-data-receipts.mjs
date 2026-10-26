// Verified existing Production data-release receipt, not a schema migration.
// Never replay data releases over subsequent operator edits.
const productionReceipts = new Map([
  ["approved_public_exchange_plans", "c065c7745bd057b2714001a14c5770efdb1224623b2f052f4a05e5dc72363da5"],
]);
export function schemaLedger(rows, production) {
  return rows.filter(row => {
    if (!production || !productionReceipts.has(row.file)) return true;
    if (row.sha256 !== productionReceipts.get(row.file))
      throw new Error("Historical data-release receipt checksum changed.");
    return false;
  });
}
