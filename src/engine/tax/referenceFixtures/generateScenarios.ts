/**
 * One-off scenario generator for the PolicyEngine reference fixture (FIN-159). NOT run in CI.
 * Usage: npx --yes tsx src/engine/tax/referenceFixtures/generateScenarios.ts <out.json>
 * It derives bracket/ladder edges from tables.ts, so re-running it after a table change moves the
 * scenarios WITH the (possibly wrong) tables. The checked-in scenarios.json is FROZEN; regenerate
 * only for a new tax year, then re-run the reference (see README.md).
 */
import { writeFileSync } from 'node:fs';
import { TAX_TABLES } from '../tables';
type FS='single'|'mfj'|'hoh';
const S:FS[]=['single','mfj','hoh'];
const out:any[]=[]; const cnt:Record<string,number>={};
function add(cat:string,id:string,desc:string,fs:FS,people:{age:number;wages:number}[],other:number,pref:number){
  if(other<0||pref<0||people.some(p=>p.wages<0)) return;
  const wages=people.reduce((a,p)=>a+p.wages,0);
  out.push({id:`${cat}.${id}`,category:cat,description:desc,
    neutral:{filingStatus:fs,people,otherOrdinaryIncome:other,ltcgQualifiedDividends:pref,taxYear:2026},
    engineInput:{year:2026,filingStatus:fs,ordinaryIncome:wages+other,preferentialIncome:pref,
      people:people.map(p=>({earnedIncome:p.wages,age:p.age})),indexing:{chainedCpiU:0,averageWageIndex:0}}});
  cnt[cat]=(cnt[cat]||0)+1;
}
const t=(fs:FS)=>TAX_TABLES[fs]!;
const std=(fs:FS)=>t(fs).standardDeductionBase.published[2026];
const ord=(fs:FS)=>t(fs).ordinaryLadder.published[2026];
const pl=(fs:FS)=>t(fs).preferentialLadder.published[2026];
const two=(fs:FS,w:number,a=40)=>fs==='mfj'?[{age:a,wages:w},{age:a,wages:0}]:[{age:a,wages:w}];
for(const fs of S){
  ord(fs).slice(1).forEach((b,i)=>{ for(const d of [-1,0,1]){
    const g=b.lowerBound+d+std(fs);
    add('bracket_wage',`${fs}.b${i+2}.${d}`,`${fs}, wages only age 40, taxable income = ${b.rate*100}% bracket start (${b.lowerBound}) ${d>=0?'+':''}${d}`,fs,two(fs,g),0,0);
    add('bracket_nonwage',`${fs}.b${i+2}.${d}`,`${fs}, non-wage ordinary only age 40, taxable income = ${b.rate*100}% bracket start (${b.lowerBound}) ${d>=0?'+':''}${d}`,fs,two(fs,0),g,0);
  }});
  const levels:[string,number][]=[['ord0',0],['ord12',(ord(fs)[1].lowerBound+ord(fs)[1].upperBound)/2],['ord24',(ord(fs)[3].lowerBound+ord(fs)[3].upperBound)/2]];
  pl(fs).slice(1).forEach((b,i)=>{ for(const [ln,ti] of levels) for(const d of [-1,0,1]){
    const gord=ti===0?0:ti+std(fs); const taxOrd=Math.max(0,gord-std(fs));
    const pref=b.lowerBound+d-taxOrd;
    if(pref<0) continue;
    add('preferential',`${fs}.${i?'15to20':'0to15'}.${ln}.${d}`,`${fs}, non-wage ordinary ${gord} (taxable ${taxOrd}) + LTCG/QD so total taxable = ${i?'15%->20%':'0%->15%'} edge (${b.lowerBound}) ${d>=0?'+':''}${d}`,fs,two(fs,0),gord,pref);
  }});
}
// age 65
const sa=(fs:FS,ages:number[],inc:number,tag:string,desc:string)=>add('age65',tag,desc,fs,ages.map((a)=>({age:a,wages:0})),inc,0);
for(const inc of [50000,75000,100000,125000,175000,200000]){
  sa('single',[64],inc,`single.64.${inc}`,`single age 64 control, non-wage ordinary ${inc}`);
  sa('single',[65],inc,`single.65.${inc}`,`single age 65, non-wage ordinary ${inc}`);
  sa('hoh',[65],inc,`hoh.65.${inc}`,`hoh age 65, non-wage ordinary ${inc}`);
}
for(const inc of [80000,120000,150000,175000,200000,250000,300000]){
  sa('mfj',[64,64],inc,`mfj.0of2.${inc}`,`mfj both 64 control, ordinary ${inc}`);
  sa('mfj',[65,64],inc,`mfj.1of2.${inc}`,`mfj one 65+, ordinary ${inc}`);
  sa('mfj',[65,65],inc,`mfj.2of2.${inc}`,`mfj both 65+, ordinary ${inc}`);
}
add('age65','single.65.wages80k','single age 65 wages 80k (FICA still applies)','single',[{age:65,wages:80000}],0,0);
add('age65','single.65.pref','single age 65, ordinary 60k + LTCG 40k','single',[{age:65,wages:0}],60000,40000);
add('age65','mfj.2of2.pref','mfj both 65+, ordinary 100k + LTCG 80k','mfj',[{age:65,wages:0},{age:65,wages:0}],100000,80000);
// FICA
const W=[184499,184500,184501,199999,200000,200001,250000,300000];
for(const w of W) add('fica',`single.${w}`,`single wages ${w}`,'single',[{age:40,wages:w}],0,0);
for(const w of [199999,200000,200001]) add('fica',`hoh.${w}`,`hoh wages ${w}`,'hoh',[{age:40,wages:w}],0,0);
for(const w of [184499,184500,184501,249999,250000,250001,400000]) add('fica',`mfj.one.${w}`,`mfj one earner wages ${w}, spouse 0`,'mfj',[{age:40,wages:w},{age:40,wages:0}],0,0);
for(const [a,b] of [[100000,100000],[150000,150000],[200000,100000],[184500,184500],[184501,184501],[300000,50000],[125000,125000],[125000,125001],[124999,125000],[184000,10000],[300000,300000]])
  add('fica',`mfj.dual.${a}_${b}`,`mfj dual earners ${a} and ${b}`,'mfj',[{age:40,wages:a},{age:40,wages:b}],0,0);
add('fica','single.wages150k.other100k','single wages 150k + other ordinary 100k (AddlMedicare on wages only)','single',[{age:40,wages:150000}],100000,0);
add('fica','single.wages190k.other50k','single wages 190k + other ordinary 50k','single',[{age:40,wages:190000}],50000,0);
add('fica','single.0','single zero income','single',[{age:40,wages:0}],0,0);
// typical
for(const [fs,w,o,p,d] of [['single',60000,0,0,'$60k wages'],['single',100000,0,0,'$100k wages'],['single',250000,0,0,'$250k wages'],['single',1000000,0,0,'$1M wages'],['mfj',100000,0,0,'$100k wages one earner'],['mfj',250000,0,0,'$250k wages'],['mfj',1000000,0,0,'$1M wages'],['hoh',60000,0,0,'$60k wages'],['hoh',250000,0,0,'$250k wages'],['single',90000,20000,15000,'wages 90k + 20k interest + 15k LTCG'],['mfj',180000,30000,60000,'wages 180k + 30k other + 60k LTCG'],['single',0,0,500000,'$500k LTCG only'],['mfj',0,0,1000000,'$1M LTCG only'],['single',30000,0,0,'$30k wages']] as [FS,number,number,number,string][])
  add('typical',`${fs}.${d.replace(/[^a-z0-9]+/gi,'_')}`,`${fs} ${d}`,fs,two(fs,w),o,p);
// Added after the first 241 (kept last so the original scenarios stay byte-identical):
// preferential income well past the 15%->20% edge (the edge-only +-1 scenarios can't catch a threshold that is off by $100+),
// and ordinary income well into the 35%/37% brackets.
for(const fs of S){
  const edge=pl(fs)[2].lowerBound;
  for(const d of [10000,50000]) add('preferential',`${fs}.15to20.ord0.+${d}`,`${fs}, LTCG/QD only so total taxable = 15%->20% edge (${edge}) +${d}`,fs,two(fs,0),0,edge+d);
}
for(const fs of S){
  const top=ord(fs)[ord(fs).length-1];
  add('bracket_nonwage',`${fs}.top.+50000`,`${fs}, non-wage ordinary only age 40, taxable income = ${top.rate*100}% bracket start (${top.lowerBound}) +50000`,fs,two(fs,0),top.lowerBound+50000+std(fs),0);
}
writeFileSync(process.argv[2],JSON.stringify(out,null,1));
console.log(out.length,JSON.stringify(cnt));
