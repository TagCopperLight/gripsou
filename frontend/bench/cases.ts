import type { Page } from "playwright";
import type { ReadyContract } from "./readiness";
export type BrowserCase = {path:string; contract:ReadyContract; requests:string[]; action?: (page:Page)=>Promise<void>; cached?:boolean};
const dashboard:BrowserCase={path:"/",contract:{heading:"Dashboard",minCharts:2},requests:["/dashboard/net-worth","/dashboard/distribution","/holdings"]};
const transactions:BrowserCase={path:"/budget/transactions",contract:{heading:"Budget",minCharts:0,selector:"tbody tr"},requests:["/transactions?","/transactions/counts"]};
export function browserCase(id:string):BrowserCase {
 switch(id){
 case "browser.dashboard.ready":return dashboard;
 case "browser.accounts.ready":return {path:"/accounts",contract:{heading:"Accounts",minCharts:1,text:"Account 0"},requests:["/accounts","/accounts/series"]};
 case "browser.investments.ready":return {path:"/investments",contract:{heading:"Investments",minCharts:0,text:"Account 0"},requests:["/holdings","/investments/returns"]};
 case "browser.budget.ready":return {path:"/budget/overview",contract:{heading:"Budget",minCharts:2},requests:["/budget/summary","/budget/trend"]};
 case "browser.transactions.ready":return transactions;
 case "browser.dashboard.return-cached":return {...dashboard,cached:true};
 case "browser.transactions.search":return {...transactions,contract:{...transactions.contract,text:"Market groceries"},requests:["search=Market"],action:async p=>{await p.getByPlaceholder("Search descriptions").fill("Market");}};
 case "browser.transactions.filter":return {...transactions,requests:["accountId="],action:async p=>{await p.getByRole("button",{name:"All accounts",exact:true}).click();await p.getByRole("button",{name:"Account 0",exact:true}).click();}};
 case "browser.transactions.next-page":return {...transactions,requests:["offset=200"],contract:{...transactions.contract,selector:"tbody tr:nth-child(201)"},action:async p=>{await p.getByTestId("load-more").click();}};
 case "browser.lots.open":return {...dashboard,contract:{minCharts:0,selector:'[role="dialog"]'},requests:["/lots","/lots/suggestions","/lots/preview"],action:async p=>{await p.getByRole("button",{name:"Record buy/sell history",exact:true}).first().click();}};
 case "browser.chart.range":return {...dashboard,requests:["range=max"],action:async p=>{await p.getByRole("radio",{name:"max",exact:true}).first().click();}};
 case "browser.navigation.repeat":return {...dashboard,cached:true};
 default:throw new Error("unsupported browser case");
 }
}
