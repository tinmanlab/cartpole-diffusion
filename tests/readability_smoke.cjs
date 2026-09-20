const fs=require("fs"),path=require("path");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const required=[
  'body{margin:0;background:linear-gradient(180deg,#fafbfc,#f4f5f7);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px',
  '.topbar strong{font-size:18px',
  '.mode-switch button{border:0;background:transparent;border-radius:6px;padding:5px 10px;font-size:11px',
  '.replay-head h2{font-size:18px',
  '.replay-head p{font-size:11px',
  '.replay-card-head b{font-size:13px',
  '.replay-values b,.replay-metrics b{font:11px',
  '.replay-head .eyebrow{font-size:11px',
  '.replay-clock span{font-size:11px',
  '.replay-card-head span{font-size:11px',
  '.replay-card-head strong{font-size:11px',
  '.replay-values span,.replay-metrics span{display:block;font-size:11px',
  '.replay-plan-meta{margin-top:6px;font:11px',
  '.replay-controls span{font:11px',
  '.replay-note{margin-top:10px;padding:9px 11px;border-radius:8px;background:#f5f3fa;font-size:11px',
  '.card-head b{font-size:15px',
  '.card-head span i{font-style:normal;font:700 11px',
  '.controls button:disabled{opacity:.38',
  '.guide-copy b{display:block;font-size:14px',
  '.guide-copy span{display:block;font-size:14px',
  '.guide-shared-label{display:block;font-size:14px',
  '.guide-step{min-width:118px',
  '.stage-btn{min-height:44px;border:1px solid #cfd6e3;border-radius:8px;background:#fff;font-size:14px',
  '.stage-btn span{display:block;font-size:14px',
  '.guide-identity{flex-basis:100%;font-size:14px',
  '.step-head b{display:block;font-size:16px',
  '.obs-values b{display:block;font:17px',
  '.obs-values small{font-size:11px',
  '.conditioning-head b{display:block;font-size:14px',
  '.conditioning-head span{display:block;font-size:11px',
  '.cond-obs b{display:block;font:700 15px',
  '.conditioning-summary b{display:block;font:700 14px',
  '.conditioning-note{margin:8px 0 0',
  '.divergence-head b{display:block;font-size:13px',
  '.divergence-head span{display:block;font-size:11px',
  '.divergence-head strong{font:700 12px',
  '.divergence-legend{display:flex;justify-content:flex-end;gap:12px;font-size:11px',
  '.divergence-metrics span{display:block;font-size:11px',
  '.divergence-metrics b{display:block;font:700 13px',
  '.sampling-head b{display:block;font-size:14px',
  '.sampling-head span{display:block;font-size:11px',
  '.sampling-condition b{display:block;font:700 15px',
  '.sampling-summary b{display:block;font:700 13px',
  '.sampling-note{margin:8px 0 0',
  '.policy-plain{border-left:4px',
  'font-size:13px;line-height:1.65',
  '.sequence-title{font:700 15px',
  '.sequence-scale{font:11px',
  '.sequence-plain{',
  '.exec-now strong{font:22px',
  '.exec-action small{font-size:11px',
  '.horizon-head b{display:block;font-size:13px',
  '.horizon-head span{display:block;font-size:11px',
  '.horizon-metrics strong{display:block;font-size:12px',
  '.horizon-labels{display:grid;grid-template-columns:1fr 1fr 2fr 1fr 1fr;align-items:center;margin-top:7px;font-size:11px',
  '.horizon-groups span{display:block;font-size:11px',
  '.horizon-note{margin:8px 0 0;font-size:11px',
  '.reobserve-title b{font-size:13px',
  '.reobserve-cell b{font:700 14px',
  '.reobserve-cell em{display:block',
  '.timeline-head b{display:block;font-size:14px',
  '.timeline-status strong{display:block;font-size:13px',
  '.timeline-caption{margin-top:4px;font-size:11px',
  '.timeline-scale{display:flex;justify-content:space-between;gap:8px;font-size:11px',
  // Chart axis labels live in HTML, not in viewBox-scaled <text>, so their px size is real.
  '.chart-axis{display:flex;justify-content:space-between;gap:8px;font-size:11px',
  '.denoise-update-head b{display:block;font-size:14px',
  '.update-card strong{display:block;font:700 17px',
  '.update-card span{display:block;font-size:11px',
  '.update-card small{display:block;font-size:11px',
  '.update-chart-title span{font-size:11px',
  '.denoise-update-note{margin:7px 0 0',
  // The wide denoise sequence must never be scaled below 1:1 against its 980-unit viewBox,
  // otherwise its in-SVG labels shrink below the readability floor. .denoise-stages
  // already provides overflow-x:auto as the scroll affordance.
  '.sequence-svg{display:block;width:100%;min-width:980px',
  // Touch targets.
  '.controls button{min-height:44px',
  '.guide-start,.guide-controls button{min-height:44px',
  '.timeline-controls button,.timeline-controls select{min-height:44px',
  '.replay-controls button{min-height:44px'
];
// Fixes that must not be reintroduced.
const forbidden=[
  ['body{overflow-x:hidden','horizontal overflow must be fixed by reflow, not clipped away'],
  ['overflow-x:clip','horizontal overflow must be fixed by reflow, not clipped away'],
  ['.scene text{','plant-scene labels must stay in the HTML .sim-readout, not in viewBox-scaled <text>'],
  ['class="timeline-axis"','axis labels must be HTML .chart-axis, not viewBox-scaled <text>'],
  ['class="update-axis"','axis labels must be HTML .chart-axis, not viewBox-scaled <text>'],
  ['class="conditioning-axis"','axis labels must be HTML .chart-axis, not viewBox-scaled <text>']
];
const appJs=fs.readdirSync(path.join(__dirname,"..","app")).filter(f=>f.endsWith(".js"))
  .map(f=>fs.readFileSync(path.join(__dirname,"..","app",f),"utf8")).join("\n");
for(const token of required)if(!html.includes(token))throw new Error("readability contract missing: "+token);
for(const [token,why] of forbidden){
  if(html.includes(token))throw new Error("readability contract violated in index.html ("+token+"): "+why);
  if(appJs.includes(token))throw new Error("readability contract violated in app/*.js ("+token+"): "+why);
}
console.log("READABILITY_CONTRACT_OK");
