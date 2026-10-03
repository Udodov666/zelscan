const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'news-variants-test.html'),'utf8');
const m=html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync(path.join(__dirname,'_check_body.js'),m[1]);
console.log('EXTRACTED', m[1].length);
