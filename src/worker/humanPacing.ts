import { setTimeout as delay } from "node:timers/promises";
import type { Locator, Page } from "playwright-core";

export type MouseProfile = "smooth1" | "smooth2" | "smooth3";

export interface HumanPacingConfig {
  keyDelayMinMs: number;
  keyDelayMaxMs: number;
  scrollDelayMs: number;
  scrollDelayMinMs: number;
  scrollDelayMaxMs: number;
  tweetHoverMinSeconds: number;
  tweetHoverMaxSeconds: number;
}

const profileOrder: MouseProfile[] = ["smooth1", "smooth2", "smooth3"];

export function nextMouseProfile(previous: MouseProfile | null, preferred: MouseProfile = "smooth1"): MouseProfile {
  const start = profileOrder.includes(preferred) ? profileOrder.indexOf(preferred) : 0;
  for (let offset = 0; offset < profileOrder.length; offset += 1) {
    const candidate = profileOrder[(start + offset) % profileOrder.length];
    if (candidate !== previous) return candidate;
  }
  return preferred;
}

export function randomInt(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + Math.floor(Math.random() * (high - low + 1));
}

export function randomDelayMs(min: number, max: number): number {
  return randomInt(Math.max(0, min), Math.max(0, max));
}

export async function typeWithPacing(page: Page, text: string, config: HumanPacingConfig): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char);
    await delay(randomDelayMs(config.keyDelayMinMs, config.keyDelayMaxMs));
  }
}

export async function focusLocatorForTyping(
  locator: Locator,
  options: { clickTimeoutMs?: number; focusTimeoutMs?: number } = {}
): Promise<"click" | "focus" | "dom_focus"> {
  try {
    await locator.click({ timeout: options.clickTimeoutMs ?? 5_000 });
    return "click";
  } catch {
    try {
      await locator.focus({ timeout: options.focusTimeoutMs ?? 3_000 });
      return "focus";
    } catch {
      await locator.evaluate((element) => {
        const target = element as { focus?: () => void; select?: () => void };
        if (typeof target.focus === "function") {
          target.focus();
        }
        if (typeof target.select === "function") {
          target.select();
        }
      });
      return "dom_focus";
    }
  }
}

export async function moveToLocator(page: Page, locator: Locator, profile: MouseProfile): Promise<boolean> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    return false;
  }
  const targetX = box.x + randomInt(Math.floor(box.width * 0.2), Math.max(Math.floor(box.width * 0.8), 1));
  const targetY = box.y + randomInt(Math.floor(box.height * 0.2), Math.max(Math.floor(box.height * 0.8), 1));
  const steps = profile === "smooth1" ? randomInt(10, 18) : profile === "smooth2" ? randomInt(18, 32) : randomInt(14, 38);
  await page.mouse.move(targetX, targetY, { steps });
  if (profile !== "smooth1") {
    await delay(randomDelayMs(90, profile === "smooth2" ? 320 : 520));
  }
  return true;
}

export async function hoverVisibleTweets(page: Page, profile: MouseProfile, config: HumanPacingConfig): Promise<void> {
  const tweets = page.locator('article[data-testid="tweet"]');
  const count = Math.min(await tweets.count().catch(() => 0), 3);
  for (let index = 0; index < count; index += 1) {
    const moved = await moveToLocator(page, tweets.nth(index), profile);
    if (moved) {
      await delay(randomDelayMs(config.tweetHoverMinSeconds * 1000, config.tweetHoverMaxSeconds * 1000));
    }
  }
}

export async function scrollWithPacing(page: Page, profile: MouseProfile, config: HumanPacingConfig): Promise<number> {
  const delta = profile === "smooth1" ? randomInt(420, 760) : profile === "smooth2" ? randomInt(620, 980) : randomInt(380, 1120);
  await page.mouse.wheel(0, delta);
  const fallbackMin = Math.floor(config.scrollDelayMs * 0.65);
  const fallbackMax = Math.max(config.scrollDelayMs, 1);
  const delayMs = randomDelayMs(config.scrollDelayMinMs || fallbackMin, config.scrollDelayMaxMs || fallbackMax);
  await delay(delayMs);
  return delayMs;
}
