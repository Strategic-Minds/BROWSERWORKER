import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const TARGET = (process.env.XTREME_TARGET_URL || 'https://xtreme-ai-systems.base44.app').replace(/\/$/, '');
const PACK_ID = 'XAI-WP-0040-OPTION1-V1';
const OUT = path.resolve(process.env.XTREME_ARTIFACT_DIR || 'runtime-artifacts');
const WAIT_MS = Number(process.env.XTREME_SETTLE_MS || 1800);
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const ROUTES = [
  { id: 'OPTION1-01', path: '/', name: 'Marketing Home', regions: [['header','header'],['hero','header + section'],['primary-cta','header + section .xai-btn-solid'],['main-content','header + section ~ section']] },
  { id: 'OPTION1-02', path: '/solutions', name: 'Solutions / AI Tools', regions: [['header','header'],['hero','header + section'],['tool-grid','.xai-tool-card'],['cta','.xai-btn-solid']] },
  { id: 'OPTION1-03', path: '/industries', name: 'Industries / Use Cases', regions: [['header','header'],['hero','header + section'],['industry-grid','article'],['capability-strip','article + div, section + div']] },
  { id: 'OPTION1-04', path: '/pricing', name: 'Pricing / Packages', regions: [['header','header'],['pricing-grid','.xai-pricing-card'],['featured-plan','.xai-pricing-card.is-featured'],['cta','.xai-pricing-card .xai-btn-solid']] },
  { id: 'OPTION1-05', path: '/about', name: 'About / Why Xtreme', regions: [['header','header'],['headline','h1'],['reason-list','.xai-card-option1'],['mission','.border-l-2']] },
  { id: 'OPTION1-06', path: '/results', name: 'Results / Case Studies', regions: [['header','header'],['hero','header + section'],['case-study-grid','article'],['proof-area','.xai-card-option1']] },
  { id: 'OPTION1-07', path: '/checkout', name: 'Checkout / Payment', regions: [['header','header'],['checkout-form','main section'],['order-summary','main aside'],['complete-order','main aside button']] },
  { id: 'OPTION1-08', path: '/login', name: 'Portal Login', regions: [['login-card','form'],['logo','img[alt="Xtreme AI Systems"]'],['login-form','form'],['primary-action','form button[type="submit"]']] },
  { id: 'OPTION1-09', path: '/dashboard', name: 'Customer Dashboard anonymous boundary', protected: true },
  { id: 'OPTION1-10', path: '/approvals', name: 'Approvals Workspace anonymous boundary', protected: true },
];

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

async function findChrome() {
  for (const candidate of [process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean)) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  throw new Error('No system Chrome/Chromium found');
}

async function accessibilityAudit(page) {
  return page.evaluate(() => {
    const visible = el => { const s=getComputedStyle(el), r=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0; };
    const name = el => (el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.getAttribute('title')||(el.textContent||'')||(el.querySelector('img[alt]')?.alt||'')).trim();
    const unnamed=[...document.querySelectorAll('button,a[href],[role="button"],[role="link"]')].filter(visible).filter(el=>!name(el));
    const controls=[...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(visible);
    const unlabeled=controls.filter(el=>!(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.getAttribute('title')||(el.id&&document.querySelector(`label[for="${CSS.escape(el.id)}"]`))||el.closest('label')));
    const counts=new Map(); [...document.querySelectorAll('[id]')].map(el=>el.id).filter(Boolean).forEach(id=>counts.set(id,(counts.get(id)||0)+1));
    const duplicates=[...counts.entries()].filter(([,n])=>n>1); const h1=document.querySelectorAll('h1').length; const violations=[];
    if(h1!==1)violations.push(`Expected exactly one h1, found ${h1}`); if(unnamed.length)violations.push(`${unnamed.length} visible interactive control(s) have no accessible name`); if(unlabeled.length)violations.push(`${unlabeled.length} visible form control(s) have no accessible label`); if(duplicates.length)violations.push(`${duplicates.length} duplicate DOM id value(s)`);
    return {pass:violations.length===0,h1_count:h1,unnamed_interactive_count:unnamed.length,unlabeled_control_count:unlabeled.length,duplicate_id_count:duplicates.length,violations:violations.slice(0,25)};
  });
}

async function responsiveAudit(page) {
  return page.evaluate(() => {
    const width=document.documentElement.clientWidth,height=window.innerHeight,overflow=Math.max(0,document.documentElement.scrollWidth-width),small=[];
    if(width<=600) for(const el of document.querySelectorAll('button,a[href],input,select,textarea,[role="button"]')) { const s=getComputedStyle(el),r=el.getBoundingClientRect(); if(s.display==='none'||s.visibility==='hidden'||r.width<=0||r.height<=0)continue; if(r.width<44||r.height<44)small.push({tag:el.tagName.toLowerCase(),text:(el.getAttribute('aria-label')||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,80),width:Math.round(r.width),height:Math.round(r.height)}); }
    return {pass:overflow<=2&&small.length===0,viewport_width:width,viewport_height:height,horizontal_overflow_px:Math.round(overflow),small_touch_target_count:small.length,small_touch_targets:small.slice(0,40)};
  });
}

async function resolveRegions(page, definitions=[]) {
  const out=[];
  for(const [name,selector] of definitions){
    const all=page.locator(selector); const count=await all.count(); let box=null,index=-1;
    for(let i=0;i<count;i++){ const candidate=await all.nth(i).boundingBox().catch(()=>null); if(candidate&&candidate.width>0&&candidate.height>0){box=candidate;index=i;break;} }
    if(!count) out.push({name,selector,pass:false,error:'selector_not_found'});
    else if(!box) out.push({name,selector,pass:false,error:'region_not_visible'});
    else out.push({name,selector,matched_index:index,pass:true,x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width),height:Math.round(box.height)});
  }
  return out;
}

function expectedAnonymousAuthFailure(url,status){ if(![401,403].includes(status))return false; const u=url.toLowerCase(); return u.includes('/auth')||u.includes('/me')||u.includes('current-user')||u.includes('is-authenticated'); }

async function runCase(browser,route,viewportName,viewport){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:'dark'}); const page=await context.newPage();
  const rawConsoleErrors=[],pageErrors=[],requestFailures=[],httpErrors=[],expectedAuthHttp=[];
  page.on('console',msg=>{if(msg.type()==='error')rawConsoleErrors.push({text:msg.text().slice(0,1000),url:msg.location()?.url||''});});
  page.on('pageerror',e=>pageErrors.push(String(e?.message||e).slice(0,1000)));
  page.on('requestfailed',r=>requestFailures.push({url:r.url(),error:r.failure()?.errorText||'failed'}));
  page.on('response',r=>{const status=r.status(),url=r.url(); if(expectedAnonymousAuthFailure(url,status))expectedAuthHttp.push({status,url}); else if(status>=400)httpErrors.push({status,url});});

  const requestedUrl=`${TARGET}${route.path}`; let navigationError=null;
  try{await page.goto(requestedUrl,{waitUntil:'domcontentloaded',timeout:45000}); await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}'}).catch(()=>{}); await page.evaluate(async()=>{if('fonts'in document)await document.fonts.ready;}).catch(()=>{}); await page.waitForTimeout(WAIT_MS);}catch(e){navigationError=String(e?.message||e);}

  const finalUrl=page.url(); const pathname=(()=>{try{return new URL(finalUrl).pathname}catch{return''}})();
  const marker=await page.evaluate(()=>({pack:document.documentElement.dataset.goldenPack||null,route:document.documentElement.dataset.goldenRoute||null,version:document.documentElement.dataset.goldenVersion||null,title:document.title})).catch(()=>({pack:null,route:null,version:null,title:null}));
  let authBoundaryPass=true,markerPass;
  if(route.protected){authBoundaryPass=pathname==='/login'||pathname.startsWith('/login/');markerPass=authBoundaryPass&&marker.pack===PACK_ID&&marker.route==='OPTION1-08';}else markerPass=marker.pack===PACK_ID&&marker.route===route.id;

  const consoleErrors=rawConsoleErrors.filter(item=>{
    if(!expectedAuthHttp.length)return true;
    if(!/status of 401|status of 403/i.test(item.text))return true;
    if(!item.url)return false;
    return !expectedAuthHttp.some(x=>item.url===x.url||item.url.startsWith(x.url));
  });
  const accessibility=await accessibilityAudit(page).catch(e=>({pass:false,violations:[String(e)]})); const responsive=await responsiveAudit(page).catch(e=>({pass:false,error:String(e)}));
  const regions=route.protected?[]:await resolveRegions(page,route.regions); const regionsPass=route.protected||regions.every(x=>x.pass);
  const filename=`${route.id}-${viewportName}-actual.png`,screenshot=await page.screenshot({type:'png',fullPage:true}); await fs.writeFile(path.join(OUT,filename),screenshot);
  const operationalPass=!navigationError&&!consoleErrors.length&&!pageErrors.length&&!requestFailures.length&&!httpErrors.length;
  const pass=markerPass&&authBoundaryPass&&operationalPass&&accessibility.pass&&responsive.pass&&regionsPass;
  await context.close();
  return {pack_id:PACK_ID,route_id:route.id,route:route.path,name:route.name,protected:!!route.protected,viewport:viewportName,requested_url:requestedUrl,final_url:finalUrl,marker,marker_pass:markerPass,auth_boundary_pass:authBoundaryPass,operational_pass:operationalPass,accessibility,responsive,critical_regions:regions,critical_regions_pass:regionsPass,expected_auth_http:expectedAuthHttp,console_errors:consoleErrors,page_errors:pageErrors,request_failures:requestFailures,http_errors:httpErrors,navigation_error:navigationError,screenshot_file:filename,screenshot_sha256:sha256(screenshot),pass};
}

async function main(){
  await fs.rm(OUT,{recursive:true,force:true}); await fs.mkdir(OUT,{recursive:true}); const chromePath=await findChrome(); console.log(`Golden runtime target: ${TARGET}`); console.log(`Chrome: ${chromePath}`);
  const browser=await chromium.launch({executablePath:chromePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}); const cases=[];
  try{for(const route of ROUTES)for(const [viewportName,viewport]of Object.entries(VIEWPORTS)){process.stdout.write(`VALIDATE ${route.id} ${viewportName} ... `);const result=await runCase(browser,route,viewportName,viewport);cases.push(result);console.log(result.pass?'PASS':'FAIL');}}finally{await browser.close();}
  const generatedAt=new Date().toISOString(); const report={generated_at:generatedAt,target_url:TARGET,pack_id:PACK_ID,status:cases.every(x=>x.pass)?'PASS':'FAIL',counts:{total:cases.length,passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length},cases};
  await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(OUT,'golden-candidate-manifest.json'),JSON.stringify({schema_version:'1.0',pack_id:PACK_ID,approval_state:'CANDIDATE_NOT_APPROVED',generated_at:generatedAt,target_url:TARGET,references:cases.map(x=>({pack_id:PACK_ID,route_id:x.route_id,route:x.route,viewport:x.viewport,reference_status:'CANDIDATE_NOT_APPROVED',screenshot_file:x.screenshot_file,screenshot_sha256:x.screenshot_sha256,source:'rendered_from_live_components'}))},null,2));
  console.log(`GOLDEN_RUNTIME_${report.status} ${report.counts.passed}/${report.counts.total}`); if(report.status!=='PASS')process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
