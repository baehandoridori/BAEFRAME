const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source=path.resolve(__dirname,'../assets/proposals');
const output=path.resolve(__dirname,'proposal-renders');
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const checks=[];
  for(const name of fs.readdirSync(source).filter(x=>x.endsWith('.svg'))){
    await page.goto(pathToFileURL(path.join(source,name)).href);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('text')].map(t=>({text:t.textContent,box:t.getBBox()})).filter(x=>x.box.x<0||x.box.y<0||x.box.x+x.box.width>1440||x.box.y+x.box.height>900));
    await page.screenshot({path:path.join(output,name.replace('.svg','.png'))});
    checks.push({name,overflow});
  }
  await browser.close();
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks));
  if(checks.some(x=>x.overflow.length))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
