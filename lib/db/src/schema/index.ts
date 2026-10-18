export * from "./tenant-releases";
export * from "./global-exchange-catalog";
export * from "./tenant-integrations";
export * from "./supabase-sessions";
export * from "./tenant-telegram";
export * from "./product-config";
export * from "./white-label-requests";
export * from "./landing-products";
// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./tenants";
export * from "./access";
export * from "./catalog";
export * from "./branding";
export * from "./commerce";
export * from "./integrations";
export * from "./audit";
export * from "./plans";
export * from "./customer-notifications";
export * from "./provider-foundation";