const T=require('tesseract.js');const {parseSettlement}=require('./parser');
(async()=>{const r=await T.recognize(process.argv[2]||'sample_report.png','eng');console.log(r.data.text);console.log(JSON.stringify(parseSettlement(r.data.text),null,1));})();
