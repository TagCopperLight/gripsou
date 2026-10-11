import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import type { Handshake, Measurement } from "./protocol";
import { ready } from "./readiness";
import { browserCase } from "./cases";
const h:Handshake=JSON.parse(readFileSync(0,"utf8"));
const c=browserCase(h.target.id);
const measurement:Measurement={id:h.target.id,parameters:{viewport:[1440,900],locale:"en",timezone:"Europe/Paris",cache:c.cached?"preloaded same context":"fresh context per trial",anchor:h.anchor},boundary:h.target.boundary,reset:h.target.reset,first_ms:null,samples_ms:[],batch_size:1,reset_ms:0,rows:1,outcome:{case:h.target.id,netWorth:h.expected.netWorth,holdingCount:h.expected.holdingCount},correct:false,errors:[],diagnostics:{memory:null,memory_reason:"Chromium process memory not collected",frames_ms:[],long_tasks_ms:[]}};
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
   const pending=new Set<string>();const completed=new Set<string>();const failed:string[]=[];const bodies:Record<string,unknown>={};
   page.on("request",r=>{if(r.url().includes("/api/"))pending.add(r.url());});
   page.on("requestfailed",r=>{pending.delete(r.url());failed.push("request failed");});
   page.on("response",async r=>{if(!r.url().includes("/api/"))return;try{if(!r.ok())throw new Error("bad response");const body=await r.json();bodies[r.url()]=body;completed.add(r.url());}catch{failed.push("bad API response");}finally{pending.delete(r.url());}});
   const pre=async(path:string)=>{await page.goto(h.origin+path);await ready(page,browserCase(path==="/accounts"?"browser.accounts.ready":path==="/budget/transactions"?"browser.transactions.ready":"browser.dashboard.ready").contract,()=>pending.size,()=>completed.size>0);};
   if(c.action)await pre(c.path);
   if(c.cached){await pre("/");await page.getByRole("link",{name:"Accounts",exact:true}).first().click();await ready(page,browserCase("browser.accounts.ready").contract,()=>pending.size,()=>true);}
   completed.clear();
   await page.evaluate(()=>{const v=(window as unknown as {benchObservations:{frames:number[];longTasks:number[]}}).benchObservations;if(v){v.frames.length=0;v.longTasks.length=0;}});
   const start=await page.evaluate(()=>performance.timeOrigin+performance.now());
   if(c.action)await c.action(page);
   else if(c.cached){await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();}
   else await page.goto(h.origin+c.path);
   const required=()=>c.cached || c.requests.every(part=>Array.from(completed).some(url=>url.includes(part)));
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
