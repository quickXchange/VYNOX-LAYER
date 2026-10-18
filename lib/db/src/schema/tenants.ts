import { sql } from "drizzle-orm";
import { check, foreignKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pgTable } from "../row-security";
import { createInsertSchema } from "drizzle-zod";
import { tenantReleasesTable } from "./tenant-releases";

export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("draft"),
  environment: text("environment").notNull().default("sandbox"),
  liveReleaseId: uuid("live_release_id"),
  completedSteps: text("completed_steps").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: "tenant_live_release_owner", columns: [t.liveReleaseId, t.id], foreignColumns: [tenantReleasesTable.id, tenantReleasesTable.tenantId] }),
  check("tenants_sandbox_only", sql`environment = 'sandbox'`),
  check("tenants_valid_status", sql`status IN ('draft', 'active', 'suspended')`),
]);

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type TenantRow = typeof tenantsTable.$inferSelect;
export type InsertTenant = typeof tenantsTable.$inferInsert;