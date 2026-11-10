const $=id=>document.getElementById(id);
const valid=n=>typeof n==='number'&&Number.isFinite(n);
function bytes(n){if(!valid(n))return '—';if(n>=1e9)return (n/1e9).toFixed(3)+' GB';if(n>=1e6)return (n/1e6).toFixed(1)+' MB';return (n/1e3).toFixed(1)+' KB';}
function text(id,value){$(id).textContent=value;}
function date(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';}
function draw(data){
  const s=data.snapshot;
  $('lamp').className='lamp '+(data.stale?'stale':'online');
  text('state',s?(data.stale?'采样暂未更新':'运行采样正常'):'等待服务器接入');
  text('updated',s?'更新于 '+date(s.updatedAt):'尚无服务器数据');
  if(s){
    const t=s.traffic,ratio=t.monthlyBytes/t.budgetBytes;
    document.body.className=t.protected?'protected':ratio>=.8?'warning':'';
    text('month',t.month||'—');text('used',bytes(t.monthlyBytes));text('limit',bytes(t.budgetBytes));
    text('remaining',bytes(Math.max(0,t.budgetBytes-t.monthlyBytes)));
    text('budget-state',t.protected?'公开网站响应已限制':ratio>=.8?'已接近月度额度':'额度内运行');
    $('fill').style.width=Math.min(100,ratio*100)+'%';$('budget-meter').setAttribute('aria-valuenow',String(Math.min(100,Math.round(ratio*100))));
    text('daily',bytes(t.dailyBytes));text('rate',bytes(t.outBytesPerSecond)+'/s');text('coverage',date(t.coverageStartedAt));
    text('cpu',valid(s.cpuPercent)?s.cpuPercent.toFixed(1)+'%':'—');$('cpu-bar').style.width=(s.cpuPercent||0)+'%';
    for(const key of ['memory','disk']){
      const percent=s[key+'Total']?s[key+'Used']/s[key+'Total']*100:0;
      text(key,percent.toFixed(1)+'%');$(key+'-bar').style.width=percent+'%';
      text(key+'-detail',bytes(s[key+'Used'])+' / '+bytes(s[key+'Total']));
    }
    const hours=Math.floor((s.uptimeSeconds||0)/3600);text('uptime',hours>=24?Math.floor(hours/24)+' 天 '+hours%24+' 时':hours+' 时');
    text('game-state',s.game.online?'服务运行中':'服务暂不可达');text('connections',s.game.connections??'—');text('rooms',s.game.rooms??'—');
  }
  const history=(data.history||[]).filter(x=>valid(x.out));
  const max=Math.max(1,...history.map(x=>x.out));
  $('traffic-line').setAttribute('points',history.map((x,i)=>`${i/Math.max(1,history.length-1)*900},${110-x.out/max*95}`).join(' '));
  $('chart-empty').hidden=history.length>1;
  const v=data.visitors||{};text('visit-count',(v.observations||0)+' 条记录 · '+(v.networks||0)+' 个网络');
  $('visitor-rows').replaceChildren();
  if(!v.rows?.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='暂无记录';tr.append(td);$('visitor-rows').append(tr);}
  for(const row of v.rows||[]){const tr=document.createElement('tr');for(const value of [row.ip,[row.city,row.country].filter(Boolean).join(' · '),String(row.visits)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('visitor-rows').append(tr);}
}
let busy=false;
async function refresh(){
  if(document.hidden||busy)return;busy=true;
  try{const r=await fetch('/api/status',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();draw(await r.json());text('refresh','页面每 60 秒更新，离开标签页时暂停。');}
  catch{$('lamp').className='lamp stale';text('state','暂时无法读取');text('refresh','暂时无法读取数据，将在下一个周期重试。');}
  finally{busy=false;}
}
refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
