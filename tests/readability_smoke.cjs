const fs=require("fs"),path=require("path");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const required=[
  'body{margin:0;background:linear-gradient(180deg,#fafbfc,#f4f5f7);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px',
  '.topbar strong{font-size:18px',
  '.card-head b{font-size:15px',
  '.step-head b{display:block;font-size:16px',
  '.obs-values b{display:block;font:17px',
  '.policy-plain{border-left:4px',
  'font-size:13px;line-height:1.65',
  '.sequence-title{font:700 15px',
  '.sequence-plain{',
  '.exec-now strong{font:22px'
];
for(const token of required)if(!html.includes(token))throw new Error("readability contract missing: "+token);
console.log("READABILITY_CONTRACT_OK");
