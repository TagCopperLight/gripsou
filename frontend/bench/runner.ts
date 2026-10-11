import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import type { Handshake, Measurement } from "./protocol";
import { ready } from "./readiness";
import { browserCase } from "./cases";
import { visibleTransactions,type TransactionExpectation } from "./semantics";
const h:Handshake=JSON.parse(readFileSync(0,"utf8"));
const c=browserCase(h.target.id);
const measurement:Measurement={id:h.target.id,parameters:{viewport:[1440,900],locale:"en",timezone:"Europe/Paris",cache:c.cached?"preloaded same context":"fresh context per trial",anchor:h.anchor,quantity_gap:h.target.id==="browser.lots.open"?1:0},boundary:h.target.boundary,reset:h.target.reset,first_ms:null,samples_ms:[],batch_size:1,reset_ms:0,rows:1,outcome:{},correct:false,errors:[],diagnostics:{memory:null,memory_reason:"Chromium process memory not collected",frames_ms:[],long_tasks_ms:[]}};
let browser;
try {
 browser=await chromium.launch({headless:true});
 measurement.diagnostics.browser_version=browser.version();
 measurement.diagnostics.timer="performance.timeOrigin + performance.now across navigations; Date business clock offset separately";
 for(let trial=0;trial<1+h.warmups+h.samples;trial++){
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:"en",timezoneId:"Europe/Paris"});
  try{
   await context.addInitScript(({token,anchor})=>{
    localStorage.setItem("gripsou.token",token);
    const RealDate=Date;const offset=RealDate.parse(`${anchor}T12:00:00Z`)-RealDate.now();
    class BusinessDate extends RealDate {constructor(value?:string|number){super(value===undefined?RealDate.now()+offset:value);}static now(){return RealDate.now()+offset;}}
    Object.defineProperty(window,"Date",{value:BusinessDate});
    const longTasks:number[]=[];try{new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({entryTypes:["longtask"]});}catch{/* unsupported */}
    const frames:number[]=[];let previous=performance.now();const frame=(t:number)=>{frames.push(t-previous);previous=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
    Object.assign(window,{benchObservations:{longTasks,frames}});
   },{token:h.token,anchor:h.anchor});
   const page=await context.newPage();
   const pending=new Set<string>();const completed=new Set<string>();const failed:string[]=[];const bodies:Record<string,unknown>={};let seededPreview=false;
   page.on("request",r=>{if(r.url().includes("/api/"))pending.add(r.url());});
   page.on("requestfailed",r=>{pending.delete(r.url());failed.push("request failed");});
   page.on("response",async r=>{if(!r.url().includes("/api/"))return;try{if(!r.ok())throw new Error("bad response");const body=await r.json();if(r.url().endsWith("/lots/preview")){const rows=(r.request().postDataJSON() as {rows:unknown[]}).rows;if(rows.length===h.expected.lotCount){seededPreview=true;bodies[r.url()]=body;completed.add(r.url());}}else{bodies[r.url()]=body;completed.add(r.url());}}catch{failed.push("bad API response");}finally{pending.delete(r.url());}});
   const pre=async(path:string)=>{await page.goto(h.origin+path);await ready(page,browserCase(path==="/accounts"?"browser.accounts.ready":path==="/budget/transactions"?"browser.transactions.ready":"browser.dashboard.ready").contract,()=>pending.size,()=>completed.size>0);};
   if(c.action)await pre(c.path);
   if(c.cached){await pre("/");await page.getByRole("link",{name:"Accounts",exact:true}).first().click();await ready(page,browserCase("browser.accounts.ready").contract,()=>pending.size,()=>true);}
   completed.clear();
   await page.evaluate(()=>{const v=(window as unknown as {benchObservations:{frames:number[];longTasks:number[]}}).benchObservations;if(v){v.frames.length=0;v.longTasks.length=0;}});
   const start=await page.evaluate(()=>performance.timeOrigin+performance.now());
   if(c.action)await c.action(page);
   else if(c.cached){await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();}
   else await page.goto(h.origin+c.path);
   const required=()=> (h.target.id!=="browser.lots.open" || seededPreview) && (c.cached || c.requests.every(part=>Array.from(completed).some(url=>url.includes(part))));
   await ready(page,c.contract,()=>pending.size,required);
   if(h.target.id==="browser.navigation.repeat"){
    for(const [name,target] of [["Accounts","browser.accounts.ready"],["Investments","browser.investments.ready"],["Dashboard","browser.dashboard.ready"]]){
     await page.getByRole("link",{name,exact:true}).first().click();await ready(page,browserCase(target).contract,()=>pending.size,()=>true);
    }
   }
   const elapsed=await page.evaluate(()=>performance.timeOrigin+performance.now())-start;
   if(failed.length)throw new Error("browser API failed");
   // Independent persisted-fixture expectations, including visible headline amount.
   for(const [url,body] of Object.entries(bodies)){
    if(url.includes("/dashboard/net-worth")){const amount=Number((body as {summary:{netWorth:string}}).summary.netWorth);if(Math.abs(amount-h.expected.netWorth)>1e-7)throw new Error("wrong browser net worth");
     const visible=await page.locator("body").innerText();const digits=amount.toFixed(2).replace(/[^0-9]/g,"");if(!visible.replace(/[^0-9]/g,"").includes(digits))throw new Error("wrong visible net worth");}
    if(url.endsWith("/holdings") && (body as unknown[]).length!==h.expected.holdingCount)throw new Error("wrong visible holdings count");
   }
   const api:Record<string,unknown>={};
   for(const [url,body] of Object.entries(bodies)){
    const parsed=new URL(url);
    if(/^\/api\/(dashboard\/|accounts(?:\/series)?$|holdings(?:\/|$)|investments\/returns|transactions(?:\?|$|\/counts)|budget\/(summary|trend))/.test(parsed.pathname))api[parsed.pathname+parsed.search]=body;
   }
   const action:Record<string,unknown>={};
   if(h.target.id==="browser.transactions.search"){
    action.search=await page.getByPlaceholder("Search descriptions").inputValue();
    if(action.search!=="Market")throw new Error("search input did not change");
    const rows=await page.locator("tbody tr").allInnerTexts();
    if(!rows.length || rows.some(row=>!row.toLowerCase().includes("market groceries")))throw new Error("search did not update visible rows");
   }
   if(h.target.id==="browser.transactions.filter"){
    action.account=await page.getByRole("button",{name:"Account 0",exact:true}).innerText();
    if(action.account!=="Account 0")throw new Error("account filter did not change");
   }
   if(h.target.id.startsWith("browser.transactions.")){
    action.visibleRows=await page.locator("tbody tr").count();
    const responses=Object.entries(api).filter(([url])=>url.startsWith("/api/transactions?") && (h.target.id!=="browser.transactions.search" || url.includes("search=Market")) && (h.target.id!=="browser.transactions.filter" || url.includes("accountId=")));
    responses.sort(([a],[b])=>Number(new URL(a,h.origin).searchParams.get("offset")??0)-Number(new URL(b,h.origin).searchParams.get("offset")??0));
    const expectedRows=h.target.id==="browser.transactions.next-page"?responses.flatMap(([,rows])=>rows as TransactionExpectation[]):responses.at(-1)?.[1] as TransactionExpectation[] | undefined;
    if(!expectedRows)throw new Error("missing transaction response");
    action.visibleTransactions=await visibleTransactions(page,expectedRows);
   }
   if(h.target.id==="browser.chart.range"){
    action.range=await page.getByRole("radio",{name:"max",exact:true}).getAttribute("aria-checked");
    if(action.range!=="true")throw new Error("chart range did not change");
   }
   if(h.target.id==="browser.lots.open"){
    action.dialog=await page.getByRole("dialog").isVisible();
    if(!action.dialog)throw new Error("lots dialog did not open");
   }
   const observed={api,action};
   if(trial===0)measurement.outcome=observed;
   else if(JSON.stringify(canonical(observed))!==JSON.stringify(canonical(measurement.outcome)))throw new Error("browser semantic outcomes differ across trials");
   if(trial===0)measurement.first_ms=elapsed;else if(trial>h.warmups)measurement.samples_ms.push(elapsed);
   const observations=await page.evaluate(()=> (window as unknown as {benchObservations:{frames:number[];longTasks:number[]}}).benchObservations);
   (measurement.diagnostics.frames_ms as number[]).push(...observations.frames);
   (measurement.diagnostics.long_tasks_ms as number[]).push(...observations.longTasks);
  }finally{await context.close();}
 }
 measurement.correct=true;
}catch(error){measurement.errors.push(String(error).replaceAll(h.token,"[redacted]").slice(0,800));}
finally{await browser?.close();}
console.log(JSON.stringify(measurement));
process.exitCode=measurement.correct?0:1;

function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value && typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
