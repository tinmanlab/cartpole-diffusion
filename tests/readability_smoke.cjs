const fs=require("fs"),path=require("path");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const required=[
  'body{margin:0;background:linear-gradient(180deg,#fafbfc,#f4f5f7);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px',
  '.topbar strong{font-size:18px',
  '.card-head b{font-size:15px',
  '.guide-copy b{display:block;font-size:13px',
  '.guide-copy span{display:block;font-size:12px',
  '.guide-step{min-width:118px',
  '.step-head b{display:block;font-size:16px',
  '.obs-values b{display:block;font:17px',
  '.obs-values small{font-size:11px',
  '.policy-plain{border-left:4px',
  'font-size:13px;line-height:1.65',
  '.sequence-title{font:700 15px',
  '.sequence-scale{font:11px',
  '.sequence-plain{',
  '.exec-now strong{font:22px',
  '.exec-action small{font-size:11px',
  '.reobserve-title b{font-size:13px',
  '.reobserve-cell b{font:700 14px',
  '.reobserve-cell em{display:block',
  '.denoise-update-head b{display:block;font-size:14px',
  '.update-card strong{display:block;font:700 17px',
  '.update-card span{display:block;font-size:11px',
  '.update-card small{display:block;font-size:11px',
  '.update-chart-title span{font-size:11px',
  '.denoise-update-note{margin:7px 0 0'
];
for(const token of required)if(!html.includes(token))throw new Error("readability contract missing: "+token);
console.log("READABILITY_CONTRACT_OK");
