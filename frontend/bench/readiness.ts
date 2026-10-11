import type { Page } from "playwright";
export type ReadyContract = { heading?: string; text?: string; minCharts: number; selector?: string };
export async function ready(page: Page, contract: ReadyContract, pending: () => number, required: () => boolean, timeout = 30_000) {
 const deadline = performance.now() + timeout;
 while (performance.now() < deadline) {
  const dom = await page.evaluate(({heading,text,minCharts,selector}) => {
   const visible=(el:Element)=>!!(el as HTMLElement).offsetParent;
   const charts=Array.from(document.querySelectorAll(".echarts-for-react")).filter(visible);
   return (!heading || Array.from(document.querySelectorAll("h1")).some(el=>el.textContent?.includes(heading))) &&
    (!text || document.body.innerText.toLowerCase().includes(text.toLowerCase())) && (!selector || !!document.querySelector(selector)) &&
    !Array.from(document.querySelectorAll(".animate-spin,.animate-pulse")).some(visible) && charts.length>=minCharts && charts.every(el=>(el as HTMLElement).dataset.chartReady==="true");
  },contract);
  if (dom && pending()===0 && required()) { await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))); if(pending()===0 && required()) return; }
  await page.waitForTimeout(20);
 }
 throw new Error(`readiness timed out: pending=${pending()} required=${required()} text=${(await page.locator("body").innerText()).slice(-1200)} DOM=${JSON.stringify(await page.locator("h1,.echarts-for-react").evaluateAll(els=>els.map(el=>({text:el.textContent?.slice(0,40),ready:(el as HTMLElement).dataset.chartReady}))))}`);
}
