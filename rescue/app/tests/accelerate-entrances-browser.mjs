import {chromium} from 'playwright';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true});const results=[];
try{
 for(const width of [390,1280])for(const slug of ['french','mandarin-chinese','japanese']){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`https://minimalpairs.co/${slug}-minimal-pairs`,{waitUntil:'networkidle'});
  const demo=page.locator('.demo-abx');await demo.scrollIntoViewIfNeeded();
  const play=demo.getByRole('button',{name:'Play A → B → X',exact:true});await play.waitFor();
  await play.click({timeout:20000});await page.waitForFunction(()=>document.querySelectorAll('.demo-abx .abx-heard-mark').length===3,{},{timeout:30000});
  await demo.locator('.demo-answer').first().click();
  await demo.getByRole('link',{name:/Practice this contrast/}).waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+slug+' '+width);
  if(errors.length)throw Error(errors.join('; '));
  if(width===390&&slug==='mandarin-chinese')await page.screenshot({path:'/tmp/mp-accelerate-mandarin-mobile.png',fullPage:true});
  results.push({slug,width,audioSequence:'played',answer:'accepted',mobileOverflow:false});await page.close();
 }
 fs.writeFileSync('/tmp/mp-accelerate-live-checks.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
