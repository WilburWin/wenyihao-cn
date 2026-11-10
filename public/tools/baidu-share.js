// Local text parsing only. Never follow a submitted URL or persist share content.
const HOSTS=new Set(['pan.baidu.com','yun.baidu.com']);
const CODE=/^[a-zA-Z0-9]{4}$/;
const fail=message=>{throw new Error(message);};

export function parseBaiduShare(text,manualCode=''){
  if(typeof text!=='string'||!text.trim())fail('请先粘贴百度网盘链接或分享文字。');
  if(text.length>4000)fail('分享文字过长，请只保留一条链接和提取码。');
  const input=text.trim(),override=String(manualCode).trim();
  if(override&&!CODE.test(override))fail('提取码应为 4 位英文字母或数字。');
  const candidates=input.match(/https?:\/\/[^\s<>"'，。；、（）【】「」《》]+/gi)||[];
  if(!candidates.length&&/^(?:pan|yun)\.baidu\.com\//i.test(input)){
    candidates.push('https://'+input.split(/\s/)[0]);
  }
  if(!candidates.length)fail('没有找到链接，请粘贴以 pan.baidu.com 开头的完整分享链接。');
  const links=new Map();
  for(const candidate of candidates){
    let url;try{url=new URL(candidate.replace(/[)\]};,.!?：:]+$/u,''));}catch{continue;}
    if(!HOSTS.has(url.hostname)||url.username||url.password||url.port)continue;
    const short=/^\/s\/(1[a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
    const init=url.pathname==='/share/init'&&/^[a-zA-Z0-9_-]+$/.test(url.searchParams.get('surl')||'');
    const legacy=url.pathname==='/share/link'&&/^\d+$/.test(url.searchParams.get('shareid')||'')&&/^\d+$/.test(url.searchParams.get('uk')||'');
    if(!short&&!init&&!legacy)continue;
    const normalized=new URL('https://pan.baidu.com/');
    if(short)normalized.pathname='/s/'+short[1];
    else if(init)normalized.pathname='/s/1'+url.searchParams.get('surl');
    else{normalized.pathname='/share/link';for(const key of ['shareid','uk'])normalized.searchParams.set(key,url.searchParams.get(key));}
    const supplied=url.searchParams.get('pwd');
    if(supplied&&!CODE.test(supplied)&&!override)fail('链接中的提取码格式不正确，请在提取码栏填写 4 位字母或数字。');
    const key=normalized.href,previous=links.get(key);
    if(previous?.code&&supplied&&previous.code!==supplied&&!override)fail('同一链接包含不同提取码，请在提取码栏确认后填写。');
    links.set(key,{url:normalized,code:override||supplied||previous?.code||''});
  }
  if(!links.size)fail('这不是受支持的百度网盘分享链接，请从百度网盘重新复制分享链接。');
  if(links.size>1)fail('检测到多条分享链接，请一次只整理一条。');
  const {url,code:embedded}=[...links.values()][0];
  const textual=[...input.matchAll(/(?:提取码|提取碼|访问码|密[码碼])\s*[:：=]?\s*([a-zA-Z0-9]{4})(?![a-zA-Z0-9])/gu)].map(match=>match[1]);
  const codes=new Set([embedded,...textual].filter(Boolean));
  if(!override&&codes.size>1)fail('链接和分享文字里的提取码不一致，请在提取码栏确认后填写。');
  const code=override||[...codes][0]||'',link=url.href;
  if(code)url.searchParams.set('pwd',code);
  return {link,code,openUrl:url.href,shareText:link+(code?' 提取码：'+code:'')};
}
