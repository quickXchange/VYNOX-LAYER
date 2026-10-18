import { check, integer, jsonb, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { pgTable } from "../row-security";
import { tenantsTable } from "./tenants";

export const tenantReleasesTable = pgTable("tenant_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references((): AnyPgColumn => tenantsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  config: jsonb("config").notNull(),
  checksum: text("checksum").notNull(),
  draftChecksum: text("draft_checksum"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique("tenant_release_version").on(t.tenantId, t.version), unique("tenant_release_owner").on(t.id, t.tenantId),
  check("tenant_releases_version_check", sql`${t.version}>0`),
  check("tenant_releases_checksum_check", sql`${t.checksum} ~ '^[0-9a-f]{64}$'`)]);

export const tenantReleaseAssetsTable = pgTable("tenant_release_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references((): AnyPgColumn => tenantsTable.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  checksum: text("checksum").notNull(),
  extension: text("extension").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique("tenant_release_asset_hash").on(t.tenantId, t.checksum)]);

export const insertTenantReleaseSchema = createInsertSchema(tenantReleasesTable).omit({ id: true, createdAt: true });
export const insertTenantReleaseAssetSchema = createInsertSchema(tenantReleaseAssetsTable).omit({ id: true, createdAt: true });
export type TenantReleaseRow = typeof tenantReleasesTable.$inferSelect;
