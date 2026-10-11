import type { Page } from "playwright";
export type TransactionExpectation={id:string;accountName:string;amount:string};
export async function visibleTransactions(page:Page,expected:TransactionExpectation[]) {
 const actual=await page.locator('tbody [data-testid="tx-row"]').evaluateAll(rows=>rows.map(row=>({id:row.getAttribute("data-transaction-id"),account:(row.children[2] as HTMLElement).innerText.trim(),amount:(row.querySelector('[data-testid="tx-amount"]') as HTMLElement).innerText.trim()})));
 if(actual.length!==expected.length)throw new Error("wrong visible transaction coverage");
 for(let i=0;i<expected.length;i++){
  const row=actual[i],want=expected[i];
  const digits=Math.abs(Number(want.amount)).toFixed(2).replace(/[^0-9]/g,"");
  if(row.id!==want.id || row.account!==want.accountName || row.amount.replace(/[^0-9]/g,"")!==digits || row.amount.includes("-")!==(Number(want.amount)<0))throw new Error("wrong visible transaction identity/order/account/amount");
 }
 return actual;
}
