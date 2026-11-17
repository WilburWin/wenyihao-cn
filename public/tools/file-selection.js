// A folder choice applies to descendants; a deeper choice overrides its parent.
export function isSelected(rules,path){
  let selected=false,length=-1;
  for(const rule of rules)if((path===rule.path||path.startsWith(rule.path==='/'?'/':rule.path+'/'))&&rule.path.length>length){selected=rule.selected;length=rule.path.length;}
  return selected;
}
export function selectionState(rules,path){
  const checked=isSelected(rules,path);
  return {checked,indeterminate:rules.some(rule=>rule.path!==path&&rule.path.startsWith(path==='/'?'/':path+'/')&&rule.selected!==checked)};
}
export function setSelection(rules,path,selected){
  return [...rules.filter(rule=>rule.path!==path&&!rule.path.startsWith(path==='/'?'/':path+'/')),{path,selected}].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
