const LS_CUSTOM="bm_custom_v1";
const LS_SECTIONS="bm_sections_v1";
// Section -> categories map. Anything not listed falls back to "Recipes".
const SECTION_ORDER=["Bread & Baking","Recipes"];
const BREAD_CATEGORIES=["Starter","Bread","Sweet","Breakfast"];
function sectionForCategory(cat){return BREAD_CATEGORIES.includes(cat)?"Bread & Baking":"Recipes"}
function getSectionState(){try{return JSON.parse(localStorage.getItem(LS_SECTIONS)||"{}")}catch(e){return{}}}
function isSectionOpen(name){const s=getSectionState();return s[name]!==false}
function setSectionOpen(name,open){const s=getSectionState();s[name]=open;localStorage.setItem(LS_SECTIONS,JSON.stringify(s))}
let homeSearchQuery="";
let RECIPES_BUILTIN=[];
function getCustom(){try{return JSON.parse(localStorage.getItem(LS_CUSTOM)||"[]")}catch(e){return[]}}
function setCustom(a){localStorage.setItem(LS_CUSTOM,JSON.stringify(a))}
function allRecipes(){return RECIPES_BUILTIN.concat(getCustom())}
function findRecipe(id){return allRecipes().find(r=>r.id===id)}

let view="home",current=null,run=null,timer=null,history=[];
const appEl=document.getElementById("app"),titleEl=document.getElementById("title"),backBtn=document.getElementById("backBtn");
document.getElementById("homeBtn").onclick=()=>{stopTimer();go("home")};
backBtn.onclick=()=>{stopTimer();back()};
function go(v,opts={}){history.push({view,current});view=v;if(opts.recipe!==undefined)current=opts.recipe;render();window.scrollTo(0,0)}
function back(){const p=history.pop();if(p){view=p.view;current=p.current}else view="home";render();window.scrollTo(0,0)}

function fmt(s){s=Math.max(0,Math.round(s));const m=Math.floor(s/60),sec=s%60;if(m>=60){const h=Math.floor(m/60);return h+"h "+(m%60)+"m"}return m+":"+String(sec).padStart(2,"0")}
function esc(s){return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2200)}

function render(){
  backBtn.style.display=(view==="home")?"none":"flex";
  if(view==="home"){titleEl.textContent="🍞 Recipe Assistant";renderHome()}
  else if(view==="detail"){titleEl.textContent=current.name;renderDetail()}
  else if(view==="run"){titleEl.textContent=current.name;renderRun()}
  else if(view==="edit"){titleEl.textContent="Customize";renderEdit()}
  else if(view==="import"){titleEl.textContent="New / Import";renderImport()}
}
function removeFab(){const f=document.getElementById("fab");if(f)f.remove()}

function recipeCardHtml(r){
  const isCustom=getCustom().some(x=>x.id===r.id);
  return `<div class="rcard" data-id="${r.id}"><div class="emoji">${r.emoji||"🍞"}</div><div class="name">${esc(r.name)}</div><div class="meta">${esc(r.totalTime||"")} · ${(r.steps||[]).length} steps</div><div>${isCustom?'<span class="badge custom">Custom</span>':'<span class="badge">'+esc(r.difficulty||"")+'</span>'}</div></div>`;
}
function matchesQuery(r,q){
  if((r.name||"").toLowerCase().includes(q))return true;
  const ings=r.ingredients||[];
  return ings.some(i=>((i.item||"")+" "+(i.note||"")+" "+(i.group||"")).toLowerCase().includes(q));
}
function renderHome(){
  const recipes=allRecipes();
  const q=homeSearchQuery.trim().toLowerCase();
  let html=`<input class="search" id="search" placeholder="Search recipes or ingredients…" value="${esc(homeSearchQuery)}" />`;
  if(q){
    const matches=recipes.filter(r=>matchesQuery(r,q));
    html+=`<div class="cat">${matches.length} result${matches.length===1?"":"s"}</div>`;
    if(matches.length){
      html+=`<div class="grid">`;
      for(const r of matches)html+=recipeCardHtml(r);
      html+=`</div>`;
    }else{
      html+=`<div class="small" style="margin:4px">No recipes match “${esc(homeSearchQuery)}”.</div>`;
    }
  }else{
    for(const sec of SECTION_ORDER){
      const cats=[...new Set(recipes.filter(r=>sectionForCategory(r.category)===sec).map(r=>r.category))];
      if(!cats.length)continue;
      const open=isSectionOpen(sec);
      html+=`<div class="section-head" data-section="${esc(sec)}"><span class="schev">${open?"▾":"▸"}</span>${esc(sec)}</div>`;
      if(open){
        for(const c of cats){
          html+=`<div class="cat">${esc(c)}</div><div class="grid">`;
          for(const r of recipes.filter(x=>x.category===c))html+=recipeCardHtml(r);
          html+=`</div>`;
        }
      }
    }
  }
  appEl.innerHTML=html;
  appEl.querySelectorAll(".rcard").forEach(el=>el.onclick=()=>go("detail",{recipe:findRecipe(el.dataset.id)}));
  appEl.querySelectorAll(".section-head").forEach(el=>el.onclick=()=>{const name=el.dataset.section;setSectionOpen(name,!isSectionOpen(name));renderHome()});
  const s=document.getElementById("search");
  s.oninput=()=>{homeSearchQuery=s.value;const pos=s.selectionStart;renderHome();const ns=document.getElementById("search");if(ns){ns.focus();ns.setSelectionRange(pos,pos)}};
  let fab=document.getElementById("fab");if(fab)fab.remove();
  fab=document.createElement("button");fab.id="fab";fab.className="fab";fab.innerHTML="＋ New / Import";fab.onclick=()=>go("import");document.body.appendChild(fab);
}
function renderDetail(){
  removeFab();const r=current;
  const nT=(r.steps||[]).filter(s=>s.timer).length;
  let html=`<div class="hero"><div class="emoji">${r.emoji||"🍞"}</div><h2>${esc(r.name)}</h2><div class="summary">${esc(r.summary||"")}</div><div class="chips"><span class="chip">⏱ ${esc(r.totalTime||"—")}</span><span class="chip">📋 ${(r.steps||[]).length} steps</span>${r.yield?`<span class="chip">🍽 ${esc(r.yield)}</span>`:""}${r.difficulty?`<span class="chip">📈 ${esc(r.difficulty)}</span>`:""}${nT?`<span class="chip">⏲ ${nT} timers</span>`:""}</div></div>
  <button class="btn primary" id="startBtn">▶ Start</button>
  <div class="btnrow"><button class="btn ghost" id="custBtn">✏️ Customize</button><button class="btn ghost" id="shareBtn">⬆️ Export</button></div>
  <div class="section-title">Ingredients</div><div class="ingredients">${renderIngredientsList(r.ingredients)}</div>`;
  if(r.tips&&r.tips.length){html+=`<div class="section-title">Tips</div><div class="tips-box">`;r.tips.forEach(t=>html+=`<div class="t">${esc(t)}</div>`);html+=`</div>`}
  if(getCustom().some(x=>x.id===r.id))html+=`<button class="btn ghost" id="delBtn" style="margin-top:14px;color:#c0392b">🗑 Delete this recipe</button>`;
  appEl.innerHTML=html;
  document.getElementById("startBtn").onclick=()=>startRun(r);
  document.getElementById("custBtn").onclick=()=>go("edit");
  document.getElementById("shareBtn").onclick=()=>exportRecipe(r);
  const del=document.getElementById("delBtn");if(del)del.onclick=()=>{if(confirm("Delete "+r.name+"?")){setCustom(getCustom().filter(x=>x.id!==r.id));toast("Deleted");go("home")}};
}
function renderIngredientsList(ings){
  if(!ings||!ings.length)return `<div class="small">No ingredients listed.</div>`;
  const grouped=ings.some(i=>i.group);let html="<ul>";
  if(grouped){let last=null;ings.forEach(i=>{if(i.group!==last){html+=`</ul><div class="ig-group">${esc(i.group)}</div><ul>`;last=i.group}html+=`<li>${esc(i.item)}${i.note?` <span class="small">(${esc(i.note)})</span>`:""}</li>`})}
  else ings.forEach(i=>html+=`<li>${esc(i.item)}${i.note?` <span class="small">(${esc(i.note)})</span>`:""}</li>`);
  return html+"</ul>";
}
function startRun(r){current=r;run={checked:new Set(),active:0,expanded:new Set()};autoStarted=new Set();history.push({view:"detail",current:r});view="run";render();window.scrollTo(0,0)}
function runSteps(r){return [{_ingredients:true,title:"Gather Ingredients & Tools",instruction:"Get everything measured and ready before you begin."}].concat(r.steps||[])}
function renderRun(){
  removeFab();const r=current,steps=runSteps(r);
  const done=run.checked.size,total=steps.length;
  let html=`<div class="progress-wrap"><div class="progressbar"><i style="width:${Math.round(done/total*100)}%"></i></div><div class="progress-label"><span>${done} of ${total} done</span><span>${done===total?"🎉 Complete!":""}</span></div></div>`;
  steps.forEach((s,i)=>{
    const isDone=run.checked.has(i),isActive=(i===run.active&&!isDone),isExp=isActive||run.expanded.has(i);
    const tr=timer&&timer.stepIdx===i;
    html+=`<div class="step ${isDone?"done":""} ${isActive?"active":""}" data-i="${i}"><div class="check" data-check="${i}">${isDone?"✓":""}</div><div class="body" data-body="${i}"><div class="stitle">${i>0?i+". ":""}${esc(s.title)}<span class="chev">${isExp?"▾":"▸"}</span>${(tr&&!isExp)?`<span class="ministamp">⏲ ${fmt(timerRemaining())}</span>`:""}${(isDone&&s.timer&&!isExp)?`<span class="ministamp">⏲</span>`:""}</div>`;
    if(isExp){
      html+=`<div class="instr">${esc(s.instruction||"")}</div>`;
      if(s._ingredients){html+=`<div class="ig-step">${renderIngredientsList(r.ingredients)}</div>`;if(r.tips&&r.tips.length)html+=`<div class="steptip">Tap a step's title to expand or collapse it. The circle on the left marks it done.</div>`}
      if(s.tip)html+=`<div class="steptip">${esc(s.tip)}</div>`;
      if(s.timer)html+=renderTimer(i,s.timer);
    }
    html+=`</div></div>`;
  });
  if(done===total)html+=`<button class="btn primary" id="finishBtn" style="margin-top:6px">✓ Finish & Back to Library</button>`;
  html+=`<button class="btn ghost" id="resetRunBtn" style="margin-top:10px">↺ Reset all steps</button>`;
  appEl.innerHTML=html;
  appEl.querySelectorAll(".check").forEach(el=>el.onclick=(e)=>{e.stopPropagation();toggleStep(+el.dataset.check)});
  appEl.querySelectorAll(".body").forEach(el=>el.onclick=(e)=>{if(e.target.closest(".timer"))return;toggleExpand(+el.dataset.body)});
  const fb=document.getElementById("finishBtn");if(fb)fb.onclick=()=>{stopTimer();toast("Nice work! 🍞");go("home")};
  document.getElementById("resetRunBtn").onclick=()=>{if(confirm("Uncheck all steps and start over?")){stopTimer();run.checked.clear();run.expanded.clear();run.active=0;autoStarted=new Set();renderRun()}};
  wireTimerButtons();maybeAutoStartTimer();
}
function toggleExpand(i){if(run.expanded.has(i))run.expanded.delete(i);else run.expanded.add(i);renderRun()}
function toggleStep(i){
  if(run.checked.has(i)){run.checked.delete(i);run.active=i;run.expanded.add(i)}
  else{run.checked.add(i);run.expanded.delete(i);if(timer&&timer.stepIdx===i)stopTimer();const steps=runSteps(current);let n=i+1;while(n<steps.length&&run.checked.has(n))n++;run.active=n}
  renderRun();
}
// ---- wall-clock timer ----
function timerRemaining(){if(!timer)return 0;if(timer.paused)return timer.pausedRemaining;return (timer.endAt-Date.now())/1000}
function renderTimer(stepIdx,t){
  const running=timer&&timer.stepIdx===stepIdx;
  const remaining=running?timerRemaining():t.seconds;
  const ring=running&&timer.ringing;
  return `<div class="timer ${ring?"ring":""}" data-step="${stepIdx}"><div class="tlabel"><span>⏲ ${esc(t.label||"Timer")}</span><span>${t.rangeText?esc(t.rangeText):""}</span></div><div class="tdisplay" id="td-${stepIdx}">${fmt(remaining)}</div><div class="tctrl">${running?`<button class="tbtn" data-act="pause" data-step="${stepIdx}">${timer.paused?"▶ Resume":"⏸ Pause"}</button><button class="tbtn" data-act="reset" data-step="${stepIdx}">↺ Reset</button>`:`<button class="tbtn go" data-act="start" data-step="${stepIdx}">▶ Start timer</button>`}<button class="tbtn" data-act="minus" data-step="${stepIdx}">−10m</button><button class="tbtn" data-act="plus" data-step="${stepIdx}">+10m</button></div></div>`;
}
function wireTimerButtons(){
  appEl.querySelectorAll(".tbtn").forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();const step=+b.dataset.step,act=b.dataset.act,s=runSteps(current)[step];
    if(act==="start")startTimer(step,s.timer.seconds);
    else if(act==="pause"){if(timer.paused){timer.endAt=Date.now()+timer.pausedRemaining*1000;timer.paused=false}else{timer.pausedRemaining=timerRemaining();timer.paused=true}renderRun()}
    else if(act==="reset")startTimer(step,s.timer.seconds);
    else if(act==="plus"){if(timer&&timer.stepIdx===step){if(timer.paused)timer.pausedRemaining+=600;else timer.endAt+=600000;updateDisplay()}else{s.timer.seconds+=600;renderRun()}}
    else if(act==="minus"){if(timer&&timer.stepIdx===step){if(timer.paused)timer.pausedRemaining=Math.max(0,timer.pausedRemaining-600);else timer.endAt=Math.max(Date.now(),timer.endAt-600000);updateDisplay()}else{s.timer.seconds=Math.max(60,s.timer.seconds-600);renderRun()}}
  });
}
let autoStarted=new Set();
function maybeAutoStartTimer(){const i=run.active,s=runSteps(current)[i];if(s&&s.timer&&!run.checked.has(i)&&!(timer&&timer.stepIdx===i)&&!autoStarted.has(current.id+":"+i)){autoStarted.add(current.id+":"+i);startTimer(i,s.timer.seconds)}}
function startTimer(stepIdx,seconds){
  stopTimer();ensureAudio();
  if("Notification"in window&&Notification.permission==="default")Notification.requestPermission();
  requestWakeLock();
  timer={stepIdx,endAt:Date.now()+seconds*1000,total:seconds,paused:false,pausedRemaining:seconds,ringing:false,interval:null};
  timer.interval=setInterval(tick,500);renderRun();
}
function tick(){if(!timer||timer.paused)return;updateDisplay();if(timerRemaining()<=0)timerDone()}
function updateDisplay(){const el=document.getElementById("td-"+timer.stepIdx);if(el)el.textContent=fmt(timerRemaining())}
function stopTimer(){if(timer&&timer.interval)clearInterval(timer.interval);if(timer)timer.ringing=false;timer=null;releaseWakeLock()}
function timerDone(){
  if(timer.ringing)return;
  clearInterval(timer.interval);timer.ringing=true;
  const s=runSteps(current)[timer.stepIdx];
  beep();if(navigator.vibrate)navigator.vibrate([400,150,400,150,400]);
  if("Notification"in window&&Notification.permission==="granted")new Notification("⏲ "+(s.timer.label||"Timer")+" done",{body:current.name+" — "+s.title});
  renderRun();toast("⏲ "+(s.timer.label||"Timer")+" finished!");
}
// recompute when returning to the app (handles backgrounding / screen lock)
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&timer&&view==="run"){if(timerRemaining()<=0&&!timer.ringing)timerDone();else renderRun()}});
window.addEventListener("focus",()=>{if(timer&&view==="run"){if(timerRemaining()<=0&&!timer.ringing)timerDone();else updateDisplay()}});
let audioCtx=null;
function ensureAudio(){if(!audioCtx){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(audioCtx&&audioCtx.state==="suspended")audioCtx.resume()}
function beep(){if(!audioCtx)return;let t=audioCtx.currentTime;for(let k=0;k<4;k++){const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.value=880;o.type="sine";o.connect(g);g.connect(audioCtx.destination);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.4,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.35);o.start(t);o.stop(t+.36);t+=.5}}
let wakeLock=null;
async function requestWakeLock(){try{if("wakeLock"in navigator)wakeLock=await navigator.wakeLock.request("screen")}catch(e){}}
function releaseWakeLock(){try{if(wakeLock){wakeLock.release();wakeLock=null}}catch(e){}}
function exportRecipe(r){
  const blob=new Blob([JSON.stringify(r,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=(r.id||"recipe")+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  if(navigator.share&&navigator.canShare){try{const f=new File([blob],(r.id||"recipe")+".json",{type:"application/json"});if(navigator.canShare({files:[f]}))navigator.share({files:[f],title:r.name})}catch(e){}}
  toast("Recipe exported");
}
function renderImport(){
  removeFab();
  appEl.innerHTML=`<div class="hero" style="text-align:left;padding:16px"><h2 style="font-size:19px;margin:0 0 6px">Add a recipe</h2><div class="small">Saved recipes live on this device and show a “Custom” badge.</div></div>
  <div class="section-title">1 · Import from a URL</div><div class="hint">Paste a link to a recipe page — we'll pull out the ingredients and steps automatically.</div>
  <input class="fi" id="urlBox" placeholder="https://example.com/some-recipe" />
  <div class="btnrow"><button class="btn primary" id="urlBtn">🔗 Fetch recipe</button></div>
  <div class="section-title">2 · Paste a recipe</div><div class="hint">Paste any recipe text (ingredients then steps). Auto-detects ingredients, steps, and timers like “bake 25 minutes”.</div>
  <textarea class="fi" id="pasteBox" placeholder="Sourdough Crackers&#10;&#10;Ingredients&#10;100g discard&#10;...&#10;&#10;Instructions&#10;1. Mix everything&#10;2. Bake 20 minutes"></textarea>
  <label class="fl">Recipe name</label><input class="fi" id="pasteName" placeholder="My New Recipe" />
  <div class="btnrow"><button class="btn primary" id="parseBtn">Parse & Preview</button><button class="btn ghost" id="aiFixBtn">Fix with AI ✨</button></div>
  <div class="section-title">3 · Import a file</div><div class="hint">Import a recipe .json exported from this app — or a bundle file containing many recipes.</div>
  <input class="fi" type="file" id="fileImp" accept="application/json,.json" />
  <div class="section-title">4 · Build from scratch</div><div class="btnrow"><button class="btn ghost" id="blankBtn">Open blank editor</button></div>`;
  document.getElementById("urlBtn").onclick=()=>importFromUrl();
  document.getElementById("parseBtn").onclick=()=>{const txt=document.getElementById("pasteBox").value.trim();const nm=document.getElementById("pasteName").value.trim();if(!txt){toast("Paste a recipe first");return}current=parseRecipe(txt,nm);go("edit",{recipe:current})};
  document.getElementById("aiFixBtn").onclick=()=>aiFixPaste();
  document.getElementById("blankBtn").onclick=()=>{current=blankRecipe();go("edit",{recipe:current})};
  document.getElementById("fileImp").onchange=(e)=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const j=JSON.parse(rd.result);const arr=(Array.isArray(j)?j:[j]).filter(r=>r&&r.name);if(!arr.length){toast("No recipes found in that file");return}for(const r of arr){r.id=uid(r.name||"imported");r.category=r.category||"Imported";saveCustomRecipe(r)}if(arr.length===1){toast("Imported!");go("detail",{recipe:arr[0]})}else{toast("Imported "+arr.length+" recipes!");go("home")}}catch(err){toast("Couldn't read that file")}};rd.readAsText(f)};
}
async function importFromUrl(){
  const input=document.getElementById("urlBox"),btn=document.getElementById("urlBtn");
  const url=input.value.trim();if(!url){toast("Paste a recipe URL first");return}
  const prevLabel=btn.textContent;btn.disabled=true;btn.textContent="Fetching…";
  try{
    const res=await fetch("/api/fetch-recipe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const data=await res.json().catch(()=>({}));
    if(data.recipe){
      const r=data.recipe;r.id=uid(r.name||"imported");r.category=r.category||"Imported";
      saveCustomRecipe(r);toast("Imported!");go("detail",{recipe:r});return;
    }
    if(data.fallbackText){
      btn.textContent="Parsing with AI…";
      const r2=await fetch("/api/parse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:data.fallbackText})});
      const parsed=await r2.json().catch(()=>({}));
      if(parsed&&parsed.name){
        parsed.id=parsed.id||uid(parsed.name||"imported");parsed.category=parsed.category||"Imported";
        saveCustomRecipe(parsed);toast("Imported!");go("detail",{recipe:parsed});return;
      }
      toast(parsed.error||"Couldn't parse that page — copy-paste the recipe text instead");return;
    }
    toast(data.hint||data.error||"Couldn't fetch that page");
  }catch(e){
    toast("Network error — check your connection");
  }finally{
    btn.disabled=false;btn.textContent=prevLabel;
  }
}
async function aiFixPaste(){
  const box=document.getElementById("pasteBox"),btn=document.getElementById("aiFixBtn");
  const txt=box.value.trim();if(!txt){toast("Paste a recipe first");return}
  const prevLabel=btn.textContent;btn.disabled=true;btn.textContent="Fixing with AI…";
  try{
    const res=await fetch("/api/parse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:txt})});
    const data=await res.json().catch(()=>({}));
    if(data&&data.name){
      data.id=data.id||uid(data.name||"imported");data.category=data.category||"Imported";
      current=data;go("edit",{recipe:current});return;
    }
    toast(data.error||"AI couldn't parse that — using local parser instead");
  }catch(e){
    toast("AI import failed (offline?) — using local parser instead");
  }finally{
    btn.disabled=false;btn.textContent=prevLabel;
  }
  const nm=document.getElementById("pasteName").value.trim();current=parseRecipe(txt,nm);go("edit",{recipe:current});
}
function blankRecipe(){return {id:uid("recipe"),name:"",category:"Custom",emoji:"🍞",yield:"",totalTime:"",difficulty:"",summary:"",ingredients:[{item:""}],tips:[],steps:[{title:"",instruction:""}]}}
function uid(name){return (name||"recipe").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,32)+"-"+Math.random().toString(36).slice(2,6)}
function parseRecipe(text,name){
  const lines=text.split(/\r?\n/).map(l=>l.trim());const r=blankRecipe();
  r.name=name||lines.find(l=>l)||"Imported Recipe";r.id=uid(r.name);r.category="Imported";r.ingredients=[];r.steps=[];let mode="";
  for(const l of lines){if(!l)continue;const low=l.toLowerCase();
    if(/^(ingredients?|you'?ll need|what you'?ll need)\b/.test(low)){mode="ing";continue}
    if(/^(instructions?|method|directions?|steps?)\b/.test(low)){mode="step";continue}
    if(/^tips?\b/.test(low)){mode="tip";continue}
    if(mode==="ing")r.ingredients.push({item:l.replace(/^[-*•]\s*/,"")});
    else if(mode==="tip")r.tips.push(l.replace(/^[-*•]\s*/,""));
    else{mode="step";const clean=l.replace(/^\s*\d+[.)]\s*/,"").replace(/^[-*•]\s*/,"");const step={title:clean.split(/[.:]/)[0].slice(0,40)||("Step "+(r.steps.length+1)),instruction:clean};const t=detectTimer(clean);if(t)step.timer=t;r.steps.push(step)}
  }
  if(!r.ingredients.length)r.ingredients=[{item:"(add ingredients)"}];
  if(!r.steps.length)r.steps=[{title:"Step 1",instruction:text.slice(0,200)}];
  r.totalTime=r.totalTime||"—";r.difficulty="Custom";return r;
}
function detectTimer(s){const m=s.match(/(\d+)\s*(?:[-–to]+\s*(\d+))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);if(!m)return null;const lo=+m[1],unit=m[3].toLowerCase();let sec=lo;if(/min/.test(unit))sec=lo*60;else if(/h/.test(unit))sec=lo*3600;let label="Timer";const v=s.match(/\b(bake|boil|rest|proof|chill|cook|ferment|rise|cool|knead|preheat|soak|simmer|mix)\b/i);if(v)label=v[1][0].toUpperCase()+v[1].slice(1).toLowerCase();return {seconds:sec,label,rangeText:m[0]}}
function saveCustomRecipe(r){const arr=getCustom().filter(x=>x.id!==r.id);arr.push(r);setCustom(arr)}
function renderEdit(){
  removeFab();const r=current;const isBuiltin=RECIPES_BUILTIN.some(x=>x.id===r.id);
  appEl.innerHTML=`<div class="hint">${isBuiltin?"Editing a built-in recipe — saves as a new custom copy.":"Editing your custom recipe."}</div>
  <label class="fl">Name</label><input class="fi" id="e_name" value="${esc(r.name)}"/>
  <div class="btnrow"><div style="flex:1"><label class="fl">Emoji</label><input class="fi" id="e_emoji" value="${esc(r.emoji||"")}"/></div><div style="flex:2"><label class="fl">Category</label><input class="fi" id="e_cat" value="${esc(r.category||"Custom")}"/></div></div>
  <div class="btnrow"><div style="flex:1"><label class="fl">Total time</label><input class="fi" id="e_time" value="${esc(r.totalTime||"")}"/></div><div style="flex:1"><label class="fl">Yield</label><input class="fi" id="e_yield" value="${esc(r.yield||"")}"/></div><div style="flex:1"><label class="fl">Difficulty</label><input class="fi" id="e_diff" value="${esc(r.difficulty||"")}"/></div></div>
  <label class="fl">Summary</label><input class="fi" id="e_sum" value="${esc(r.summary||"")}"/>
  <label class="fl">Ingredients — one per line</label><textarea class="fi" id="e_ing">${esc((r.ingredients||[]).map(i=>(i.group?"["+i.group+"] ":"")+i.item).join("\n"))}</textarea>
  <div class="hint">Group with [Dough] or [Filling] at the start of a line.</div>
  <label class="fl">Tips — one per line</label><textarea class="fi" id="e_tips">${esc((r.tips||[]).join("\n"))}</textarea>
  <label class="fl">Steps</label><div class="hint">One step per line as <b>Title :: Instruction</b>. Timer with <b>@25m</b> / <b>@45s</b> / <b>@2h</b>. Per-step tip with <b>#tip</b>.</div>
  <textarea class="fi" id="e_steps" style="min-height:200px">${esc(stepsToText(r.steps))}</textarea>
  <button class="btn primary" id="saveBtn" style="margin-top:14px">💾 Save${isBuiltin?" as new recipe":""}</button>`;
  document.getElementById("saveBtn").onclick=()=>saveFromEditor(isBuiltin);
}
function stepsToText(steps){return (steps||[]).map(s=>{let line=(s.title||"")+" :: "+(s.instruction||"");if(s.timer)line+=" @"+timerTag(s.timer);if(s.tip)line+=" #"+s.tip;return line}).join("\n")}
function timerTag(t){const s=t.seconds;if(s%3600===0)return (s/3600)+"h";if(s%60===0)return (s/60)+"m";return s+"s"}
function saveFromEditor(isBuiltin){
  const g=id=>document.getElementById(id).value;
  const r={name:g("e_name").trim()||"Untitled",emoji:g("e_emoji").trim()||"🍞",category:g("e_cat").trim()||"Custom",totalTime:g("e_time").trim(),yield:g("e_yield").trim(),difficulty:g("e_diff").trim(),summary:g("e_sum").trim(),
    ingredients:g("e_ing").split(/\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.match(/^\[([^\]]+)\]\s*(.*)$/);return m?{group:m[1],item:m[2]}:{item:l}}),
    tips:g("e_tips").split(/\n/).map(l=>l.trim()).filter(Boolean),
    steps:g("e_steps").split(/\n/).map(l=>l.trim()).filter(Boolean).map((l,i)=>{let tip=null,timer=null;const tm=l.match(/@(\d+)([smh])/);if(tm){const n=+tm[1];timer={seconds:tm[2]==="h"?n*3600:tm[2]==="m"?n*60:n,label:"Timer"};l=l.replace(/@\d+[smh]/,"").trim()}const tp=l.match(/#(.+)$/);if(tp){tip=tp[1].trim();l=l.replace(/#.+$/,"").trim()}const parts=l.split("::");const title=(parts[0]||("Step "+(i+1))).trim();const instr=(parts[1]||parts[0]||"").trim();const st={title,instruction:instr};if(timer){timer.label=guessLabel(title)||"Timer";st.timer=timer}if(tip)st.tip=tip;return st})};
  r.id=isBuiltin?uid(r.name):(current.id||uid(r.name));saveCustomRecipe(r);toast(isBuiltin?"Saved as new recipe!":"Saved!");go("detail",{recipe:r});
}
function guessLabel(t){const m=(t||"").match(/\b(bake|boil|rest|proof|chill|cook|ferment|rise|cool|knead|preheat|soak|mix)\b/i);return m?m[1][0].toUpperCase()+m[1].slice(1).toLowerCase():null}
// service worker
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
// load recipes
fetch("data/index.json").then(r=>r.json()).then(ids=>Promise.all(ids.map(id=>fetch("data/"+id+".json").then(r=>r.json())))).then(arr=>{RECIPES_BUILTIN=arr;render()}).catch(e=>{appEl.innerHTML='<div class="loading">Could not load recipes. Check your connection and reload.</div>'});
