// Run after preview templates exist. Emits disabled configuration, never approves copy.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const source=new URL('../company/email-course/templates.json',import.meta.url);
const raw=fs.readFileSync(source,'utf8'),input=JSON.parse(raw),out={};
const weeklyRaw=fs.readFileSync(new URL('../company/email-course/weekly-drafts.json',import.meta.url),'utf8');
const weekly=JSON.parse(weeklyRaw);
function convert(message){
 const paragraphs=message.paragraphs;if(!Array.isArray(paragraphs)||!message.subject||!message.cta?.url)throw Error('Invalid preview template');
 const url=message.cta.url.replaceAll('{{confirmationUrl}}','{{confirmation_url}}');
 return {approved:false,promotional:false,subject:message.subject,text:[...paragraphs,`${message.cta.label}: ${url}`,message.step==='confirmation-v1'?'':input.footer.replaceAll('{{unsubscribeUrl}}','{{unsubscribe_url}}').replaceAll('{{postalAddress}}','{{postal_address}}')].filter(Boolean).join('\n\n')};
}
for(const lang of input.languages)for(const message of lang.messages)out[message.step+':'+lang.bankId]=convert(message);
for(const lang of weekly.languages)for(const message of lang.messages){
 if(!/^weekly-[1-9]\d*$/.test(message.step))throw Error('Invalid weekly sequence');
 out[message.step+':'+lang.bankId]=convert(message);
}

fs.writeFileSync(new URL('templates.unapproved.json',import.meta.url),JSON.stringify({sourceSha256:createHash('sha256').update(JSON.stringify([raw,weeklyRaw])).digest('hex'),templates:out},null,2)+'\n');
console.log(`Prepared ${Object.keys(out).length} templates, all unapproved.`);
