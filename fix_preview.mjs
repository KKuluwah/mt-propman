import { readFileSync, writeFileSync } from 'fs';

const file = 'c:\\Mayemou\\mt-propman\\public\\index.html';
let html = readFileSync(file, 'utf8');

// Replace the broken previewEmail function
const broken = /async function previewEmail\(invoiceId\)\{[\s\S]*?\n\}\n\}/;

const fixed = `async function previewEmail(invoiceId){
 _emailInvoiceId=invoiceId;
 const data=await fetch(\`/api/invoices/\${invoiceId}/email-preview\`).then(r=>r.json());
 if(data.error){toast(data.error,'error');return;}
 const inv=data.inv,s=data.settings;
 const hasEmail=inv.tenant_email&&inv.tenant_email.trim()!=='';
 const fmtD=(d)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-PG',{day:'2-digit',month:'short',year:'numeric'}):'-';
 document.getElementById('email-to-addr').textContent=hasEmail?inv.tenant_email:'No email on file';
 document.getElementById('email-subject-preview').textContent=\`Invoice \${inv.invoice_no} \${inv.property_name}\${inv.unit_name?' / '+inv.unit_name:''} Due \${fmtD(inv.due_date)}\`;
 const btn=document.getElementById('btn-confirm-send'),warn=document.getElementById('email-no-addr-warn');
 if(!hasEmail){btn.disabled=true;btn.style.opacity='0.4';warn.style.display='inline';}
 else{btn.disabled=false;btn.style.opacity='1';warn.style.display='none';}
 inv.settings=s;
 document.getElementById('email-iframe').srcdoc='<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:16px;background:#f4f7fb;font-family:Arial,sans-serif}</style></head><body>'+buildInvoiceHTML(inv)+'</body></html>';
 openModal('modal-email-preview');
}`;

if (!broken.test(html)) { console.error('Pattern not found'); process.exit(1); }
html = html.replace(broken, fixed);
writeFileSync(file, html, 'utf8');
console.log('Done');
