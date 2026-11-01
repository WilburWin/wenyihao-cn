(function (root) {
  'use strict';
  const SIZE = 19, KOMI = 7.5;
  const empty = () => Array.from({length: SIZE}, () => Array(SIZE).fill(0));
  const clone = board => board.map(row => row.slice());
  const around = (x, y) => [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b]) => a>=0 && b>=0 && a<SIZE && b<SIZE);
  function group(board, x, y) {
    const color=board[y][x], stones=[], liberties=new Set(), seen=new Set([y*SIZE+x]), stack=[[x,y]];
    while(stack.length){const [cx,cy]=stack.pop();stones.push({x:cx,y:cy});for(const [nx,ny] of around(cx,cy)){const key=ny*SIZE+nx;if(!board[ny][nx])liberties.add(key);else if(board[ny][nx]===color&&!seen.has(key)){seen.add(key);stack.push([nx,ny])}}}
    return {stones,liberties};
  }
  function play(board,x,y,color,previous=null){
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=SIZE||y>=SIZE||board[y][x]||![1,2].includes(color))return null;
    const next=clone(board),removed=[];next[y][x]=color;
    const seen=new Set();
    for(const [nx,ny] of around(x,y))if(next[ny][nx]===3-color&&!seen.has(ny*SIZE+nx)){
      const chain=group(next,nx,ny);chain.stones.forEach(p=>seen.add(p.y*SIZE+p.x));
      if(!chain.liberties.size)for(const p of chain.stones){removed.push({...p,color:3-color});next[p.y][p.x]=0}
    }
    if(!group(next,x,y).liberties.size)return null;
    if(previous && next.every((row,ry)=>row.every((cell,rx)=>cell===previous[ry][rx])))return null;
    return {board:next,removed};
  }
  function score(board){
    const area={1:0,2:0},territory={1:0,2:0},seen=new Set();
    for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
      if(board[y][x]){area[board[y][x]]++;continue}
      const key=y*SIZE+x;if(seen.has(key))continue;
      const stack=[[x,y]],region=[],border=new Set();seen.add(key);
      while(stack.length){const [cx,cy]=stack.pop();region.push([cx,cy]);for(const [nx,ny] of around(cx,cy)){
        const c=board[ny][nx],k=ny*SIZE+nx;
        if(c)border.add(c);else if(!seen.has(k)){seen.add(k);stack.push([nx,ny])}
      }}
      if(border.size===1){const c=[...border][0];territory[c]+=region.length;area[c]+=region.length}
    }
    const black=area[1],white=area[2]+KOMI;
    return {black,white,stones:{black:area[1]-territory[1],white:area[2]-territory[2]},territory:{black:territory[1],white:territory[2]},komi:KOMI,winner:black>white?1:2,margin:Math.abs(black-white)};
  }
  function parseSGF(input){
    const src=String(input||'');if(src.length>2_000_000)throw Error('棋谱文件过大（上限 2 MB）。');
    let i=src.indexOf('(');if(i<0)throw Error('没有找到 SGF 棋谱。');
    const space=()=>{while(/\s/.test(src[i]||'')&&i<src.length)i++};
    function tree(){
      space();if(src[i++]!=='(')throw Error('SGF 结构不完整。');const seq=[],children=[];
      while(i<src.length){space();if(src[i]===';'){i++;const props={};while(i<src.length){space();const start=i;while(/[A-Z]/.test(src[i]||''))i++;if(start===i)break;const key=src.slice(start,i);const vals=[];space();while(src[i]==='['){i++;let value='';while(i<src.length&&src[i]!==']'){if(src[i]==='\\'){i++;if(i<src.length)value+=src[i++]}else value+=src[i++]}if(src[i++]!==']')throw Error('SGF 属性没有闭合。');vals.push(value);space()}if(!vals.length)throw Error('SGF 属性格式错误。');props[key]=(props[key]||[]).concat(vals)}seq.push(props)}
      else if(src[i]==='(')children.push(tree());else if(src[i]===')'){i++;return {seq,children}}else throw Error('SGF 结构格式错误。')}
      throw Error('SGF 棋谱没有结束符。');
    }
    const first=tree(),nodes=[];let branch=first;while(branch){nodes.push(...branch.seq);branch=branch.children[0]}
    const info=nodes[0]||{};if(info.SZ?.[0]!=='19')throw Error('目前只支持 19 路 SGF 棋谱。');if(info.AB||info.AW)throw Error('暂不支持带预置棋子的 SGF。');
    const moves=[];for(const node of nodes){const key=node.B?'B':node.W?'W':null;if(!key)continue;const raw=node[key][0]||'';if(raw!==''&&raw!=='tt'&&!/^[a-s]{2}$/.test(raw))throw Error('棋谱中有无效坐标。');moves.push({c:key==='B'?1:2,p:raw==='tt'?'':raw})}
    if(!moves.length)throw Error('棋谱里没有可复盘的着手。');
    return {title:(info.GN?.[0]||info.EV?.[0]||'导入棋谱').slice(0,50),black:(info.PB?.[0]||'黑方').slice(0,40),white:(info.PW?.[0]||'白方').slice(0,40),moves};
  }
  function toSGF(record){
    const esc=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\]/g,'\\]').replace(/[\r\n]+/g,' ');
    const date=(record.date||new Date().toISOString()).slice(0,10),result=record.result?.method==='resign'?`${record.result.winner===1?'B':'W'}+R`:record.result?.method==='score'?`${record.result.winner===1?'B':'W'}+${Number(record.result.margin).toFixed(1)}`:'';
    const header=`(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[${KOMI}]DT[${esc(date)}]PB[${esc(record.players?.[1]||'黑方')}]PW[${esc(record.players?.[2]||'白方')}]RE[${esc(result)}]`;
    return header+(record.moves||[]).map(m=>`;${m.c===1?'B':'W'}[${m.pass?'':String.fromCharCode(97+m.x)+String.fromCharCode(97+m.y)}]`).join('')+')';
  }
  const api={SIZE,KOMI,empty,clone,around,group,play,score,parseSGF,toSGF};
  root.GoCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
