/** @area auth
 * @priority P0
 * Real production Web build against an isolated server daemon and HTTPS proxy.
 */
import { test, expect, startAdminServer } from './fixtures/admin-server';
import type { Page } from '@playwright/test';
import type { AdminServer } from './fixtures/admin-server';

export async function login(page:Page,admin:AdminServer) {
  await page.locator('[data-testid="admin-username-input"]').fill(admin.username);
  await page.locator('[data-testid="admin-password-input"]').fill(admin.password);
  await page.locator('[data-testid="admin-login-submit"]').click();
  await expect(page.locator('.entry-shell')).toBeVisible({timeout:15000});
}
test('anonymous workspace is never mounted and only session discovery runs',async({page,admin})=>{
  const privateRequests:string[]=[];page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/')&&p!=='/api/access/session')privateRequests.push(p);});
  await page.goto(`${admin.origin}/settings?tab=runtimes#keep`);
  await expect(page.locator('[data-testid="admin-login-form"]')).toBeVisible();
  await expect(page.locator('.entry-shell')).toHaveCount(0);expect(privateRequests).toEqual([]);
});
test('login form retains a deep link and refreshing restores the administrator session',async({page,admin})=>{
  await page.goto(`${admin.origin}/settings?tab=runtimes#keep`);await login(page,admin);
  await expect(page).toHaveURL(`${admin.origin}/settings?tab=runtimes#keep`);await page.reload();
  await expect(page.locator('.entry-shell')).toBeVisible();await expect(page.locator('[data-testid="admin-logout-btn"]')).toBeVisible();
});
test('wrong password is an inline error and clears the password only',async({page,admin})=>{
  await page.goto(admin.origin);await page.locator('[data-testid="admin-username-input"]').fill(admin.username);await page.locator('[data-testid="admin-password-input"]').fill('incorrect');await page.locator('[data-testid="admin-login-submit"]').click();
  await expect(page.locator('[data-testid="admin-login-error"]')).toBeVisible();await expect(page.locator('[data-testid="admin-password-input"]')).toHaveValue('');await expect(page.locator('[data-testid="admin-username-input"]')).toHaveValue(admin.username);await expect(page.locator('.entry-shell')).toHaveCount(0);
});
test('unreachable discovery has a retry action and never falls back to local',async({page,admin})=>{
  await page.route('**/api/access/session',r=>r.fulfill({status:503,body:'unavailable'}));await page.goto(admin.origin);
  await expect(page.locator('[data-testid="admin-access-retry"]')).toBeVisible();await expect(page.locator('.entry-shell')).toHaveCount(0);
  await page.unroute('**/api/access/session');await page.locator('[data-testid="admin-access-retry"]').click();await expect(page.locator('[data-testid="admin-login-form"]')).toBeVisible();
});
test('logout cancellation preserves the page and confirmed logout removes private DOM',async({page,admin})=>{
  await page.goto(`${admin.origin}/settings`);await login(page,admin);let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/access/logout')writes++;});
  await page.locator('[data-testid="admin-logout-btn"]').click();await page.locator('[data-testid="admin-logout-cancel"]').click();expect(writes).toBe(0);await expect(page.locator('.entry-shell')).toBeVisible();
  await page.locator('[data-testid="admin-logout-btn"]').click();await page.locator('[data-testid="admin-logout-confirm"]').click();await expect(page.locator('[data-testid="admin-login-form"]')).toBeVisible();await expect(page.locator('.entry-shell')).toHaveCount(0);expect(writes).toBe(1);
});
test('rate limiting prevents a second submit and the login page fits a narrow screen',async({page,admin})=>{
  await page.setViewportSize({width:320,height:720});await page.route('**/api/access/login',r=>r.fulfill({status:429,contentType:'application/json',headers:{'Retry-After':'60'},body:'{"error":"rate_limited"}'}));await page.goto(admin.origin);
  await page.locator('[data-testid="admin-username-input"]').fill(admin.username);await page.locator('[data-testid="admin-password-input"]').fill(admin.password);await page.locator('[data-testid="admin-login-submit"]').click();await expect(page.locator('[data-testid="admin-login-submit"]')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('local mode enters directly without administrator controls',async({page,adminWebDir})=>{
  const local=await startAdminServer({webDir:adminWebDir,username:'unused',password:'unused local test password',mode:'local'});
  try{await page.goto(`${local.origin}/settings`);await expect(page.locator('.entry-shell')).toBeVisible();await expect(page.locator('[data-testid="admin-login-form"]')).toHaveCount(0);await expect(page.locator('[data-testid="admin-logout-btn"]')).toHaveCount(0);}finally{await local.stop();}
});
