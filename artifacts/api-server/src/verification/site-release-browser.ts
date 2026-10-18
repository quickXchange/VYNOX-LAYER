import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import express from "express";
import { chromium, expect } from "@playwright/test";
import type { AddressInfo } from "node:net";
import router from "../routes/site-releases";
import { releasedConfig } from "../modules/website/release-config";
import { releaseTenant, rollbackTenant } from "../modules/website/releases";
import { admin, changeDraft, type Scope } from "./site-release-fixtures";

/** Disposable CI server mounts the real public router and compiled shared SPA.
 * Native sign-in is not mocked or bypassed; only logged-out public journeys run. */
export async function browserProof(scope: Scope) {
  const [a,b] = scope.tenants, app = express();
  const dist = path.resolve("../private-label-website/dist/public");
  const out = path.resolve("../../generated-artifacts/release-sync");
  await mkdir(out, { recursive: true });
  app.use("/api", router);
  app.use("/private-label-website", express.static(dist));
  app.get("/private-label-website/{*rest}", (_req,res) => res.sendFile(path.join(dist,"index.html")));
  app.use((e: {status?:number;message?:string},_req:express.Request,res:express.Response,_next:express.NextFunction) =>
    res.status(e.status ?? 500).json({error:e.status ? e.message : "Request failed."}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening",r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    await rollbackTenant(admin,a.id,scope.initialReleases[0]);
    const context = await browser.newContext(), page = await context.newPage();
    await page.goto(`${origin}/private-label-website/${a.slug}`);
    await expect(page.getByTestId("text-brand")).toHaveText(a.name);
    const first = await releasedConfig(a.slug);
    const img = page.locator(`img[src="${first.config.site.logoUrl}"]`).first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => (el as unknown as {naturalWidth:number}).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({path:path.join(out,"before.jpg"),fullPage:true});
    await changeDraft(scope);
    await page.reload();
    await expect(page.getByTestId("text-brand")).toHaveText(a.name);
    assert.equal((await releasedConfig(a.slug)).checksum,first.checksum);
    const start=Date.now();
    await releaseTenant(admin,a.id);
    await expect(page.getByTestId("text-brand")).toHaveText(`${a.name} Updated`,{timeout:60_000});
    assert.ok(Date.now()-start < 60_000);
    await expect(page.getByTestId("text-released-addons")).toContainText("Release Sync Add-on");
    const live=await releasedConfig(a.slug);
    await expect(page.locator(`img[src="${live.config.site.logoUrl}"]`).first()).toBeVisible();
    await page.screenshot({path:path.join(out,"after.jpg"),fullPage:true});
    const response=await page.request.get(`${origin}/api/public/site-config?slug=${a.slug}`);
    assert.equal(response.headers().etag,`"${live.checksum}"`);
    assert.equal((await page.request.get(`${origin}/api/public/site-config?slug=${a.slug}`,{headers:{"If-None-Match":`"${live.checksum}"`}})).status(),304);
    assert.equal((await page.request.get(`${origin}/api/public/site-config?slug=unknown-release-site`)).status(),404);
    assert.equal((await page.request.get(`${origin}/api/public/site-config?slug=${a.slug}`,{headers:{"X-QX-Release-Preview":"forged"}})).status(),401);
    const second=await context.newPage();
    await second.goto(`${origin}/private-label-website/${b.slug}`);
    await expect(second.getByText(b.name,{exact:true}).first()).toBeVisible();
    assert.ok(!(await second.content()).includes(`${a.name} Updated`));
    await rollbackTenant(admin,a.id,scope.initialReleases[0]);
    await expect(page.getByTestId("text-brand")).toHaveText(a.name,{timeout:60_000});
    await expect(page.locator(`img[src="${first.config.site.logoUrl}"]`).first()).toBeVisible();
    await page.goto(`${origin}/private-label-website/unknown-release-site`);
    await expect(page.getByTestId("state-unavailable")).toContainText("Site not found");
    const sentinel="qa-release-key-never-in-public-output-9b8a3";
    assert.ok(!(await page.content()).includes(sentinel));
    async function scan(dir:string):Promise<void> {
      for(const entry of await readdir(dir,{withFileTypes:true})) {
        const p=path.join(dir,entry.name);
        if(entry.isDirectory()) await scan(p);
        else if(/\.(js|html)$/.test(entry.name)) assert.ok(!(await readFile(p,"utf8")).includes(sentinel));
      }
    }
    await scan(dist);
    console.log("PASS browser: logged-out sync <60s, logo bytes, draft isolation, rollback, two tenants, unknown site, ETag/304, unauthorized preview, bundle sentinel scan.");
  } finally { await browser.close(); await new Promise<void>(r=>server.close(()=>r())); }
}
