import { chromium } from "playwright";
import assert from "node:assert/strict";
import { ready } from "./readiness";
import { visibleTransactions } from "./semantics";
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.setContent('<h1>Dashboard</h1><div class="echarts-for-react" style="height:20px" data-chart-ready="false">123.45</div>');
 const contract={heading:"Dashboard",text:"123.45",minCharts:1};
 await assert.rejects(ready(page,contract,()=>0,()=>true,60));
 await page.evaluate(()=>{(document.querySelector('.echarts-for-react') as HTMLElement).dataset.chartReady="true";});
 await assert.rejects(ready(page,contract,()=>1,()=>true,60));
 await assert.rejects(ready(page,contract,()=>0,()=>false,60));
 await assert.rejects(ready(page,{...contract,text:"999.00"},()=>0,()=>true,60));
 await page.evaluate(()=>{const el=document.createElement('div');el.className="animate-pulse";el.textContent="Skeleton";document.body.append(el);});
 await assert.rejects(ready(page,contract,()=>0,()=>true,60));
 await page.evaluate(()=>document.querySelector('.animate-pulse')?.remove());
 await ready(page,contract,()=>0,()=>true,1000);
 const expected=Array.from({length:200},(_,n)=>({id:`filtered-${n}`,accountName:"Account 0",amount:"-12.00"}));
 const table=(stale:boolean)=>`<table><tbody>${expected.map((row,n)=>`<tr data-testid="tx-row" data-transaction-id="${stale?`previous-${n}`:row.id}"><td></td><td></td><td>${stale?"Account 1":row.accountName}</td><td data-testid="tx-amount">-12.00 €</td></tr>`).join("")}</tbody></table>`;
 await page.setContent(table(true));
 await assert.rejects(visibleTransactions(page,expected));
 await page.setContent(table(false));
 await visibleTransactions(page,expected);
 await page.locator('[data-testid="tx-amount"]').first().evaluate(el=>{el.textContent="-99.00 €";});
 await assert.rejects(visibleTransactions(page,expected));
 console.log("Browser readiness and visible transaction checks passed");
} finally {await browser.close();}
