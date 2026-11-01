// The first nine modules transcribe moves 1–130 of three annotated games in Arthur Smith, The Game of Go (1908), chapter V.
// Printed coordinates omit I and number rows from the bottom; converted here to SGF top-left coordinates.
const BOOK_GAMES = [
  {number:"II",black:"内垣末吉",white:"村濑秀甫",label:"秀甫授棋例局",moves:"qd dc pq oc cp pn np de ep cj qg co do cn bp dn en em fn hq gr lq hr lo nn pk jc hc mc fm gm jq dl dm di ci dh ch dg cg gk gn hm ek gh pf qf qc rc pd qe qi nd ld hd lc mb lb pe ic id jb ed dd gc jd od je df cf qo qn ee po ro pp qq oq or nq nr op ml kl nj fq gq fp eq go eo in gp hf kj ii hi ff ef hj gj hh gi nl pj qj ol ok nk nm oj ql mm om kk jl ik jh ij mn am bm mr io eb db gb gg lh fh",focus:["四角落点与边地效率：先占角，再逐步向边上展开。", "观察白方主动挑战与黑方应对，判断何时保留先手。", "注意劫争与局部取舍，别只盯着刚落下的一子。"],notes:{"1": "教材先说明布局原则：角与边更容易建立稳固根据地。", "12": "教材认为白方这手挑战大胆，但时机偏早；比较局部攻击与全局效率。", "55": "教材指出白方暂时不应黑方这手，后续迫使黑方补强。", "91": "教材在此讨论局部劫争，留意提子与劫材的次序。"}},
  {number:"III",black:"伊藤小太郎",white:"雁金准一",label:"雁金准一例局",moves:"cp pq dc ce eq ck fd cc cb dd ec pc qe qn qi jq mc dh od oc nc rd qd qc re rc ob pb na ra id pd pe oe nd of qg ph pi oh oi lg ql jd jc kc kd je ke ic jb hc kb ie hd gd he ge hf gc ig ni nj mi mj li jh bc bb fe fb ab ga kf jf le ld pl pm qm ol rl pk qk ng nf mg mf kj ki jj qh rh pg rj qf rf rg sg kh mh lj lk ji ii nh qp pp qq qr rr pr ro pn rs pl om ok ql sq rq pl oj mp ed ee df de cm ij",focus:["无让子实战的开局结构，观察小目及角部接触战。", "中盘转换：追踪薄弱棋形及应手的轻重。", "在切断与连络之间读棋，比较教材手顺的全局目的。"],notes:{"1": "黑以小目开局，教材将它作为稳健布局的例子。", "91": "教材指出改下邻近一点会使白方有突破手段，先读清连络。", "120": "白试图破坏角部，想一想局部与外围的交换。"}},
  {number:"VI",black:"安井算哲",white:"井上因硕",label:"井上因硕古谱",moves:"qd dc pq oc cp cf po pf od pd pe pc oe qe qf re pg mc of rd qk eq iq do co dn cn dm cm dl ck kq dq dr cr dp cq ko fq fr ep er gq fp gp fo go jr fn eo ir hm hn gm im oq op nq pr np no mo nn jm jq kr jn il kn in jo mn km jp io mm jl im nm ml kk ij nl mj ji qj pj pi qi qh rj ri qj li ki ph kf kg jg lg jf lf rf rg se me ni nh oh oi ng mh nj og ld sd sf nd oh ih jh og qc rc oh qg oj og dd cd",focus:["1835 年古谱的四角布局，比较落点与方向。", "观察双方缠斗与提子，追踪被攻击棋块的气。", "中盘交错攻防：先看棋块生死，再判断大场。"],notes:{"70": "教材在此标记提子，留意刚被吃棋子的气。", "91": "教材也将此手标记为提子，比较双方战斗后的棋形。"}},
 ];
window.STARY_KIFU = BOOK_GAMES.flatMap(game => [0,1,2].map(part => {
  const all=game.moves.split(" "),from=[0,45,90][part],to=[45,90,130][part];
  return {id:`smith-1908-${game.number}-${part+1}`,group:"1908 · 教材逐手研习",title:`${game.label} · ${["布局","攻防","中盘"][part]}`,
    subtitle:`《The Game of Go》第 V 章 · 第 ${game.number} 局 · ${from+1}–${to} 手`,
    black:game.black,white:game.white,intro:`原书例局，研习第 ${from+1}–${to} 手；右侧显示教材要点。`,
    focus:game.focus[part],notes:game.notes,source:"https://www.gutenberg.org/files/66632/66632-h/66632-h.htm#ch5",
    prelude:all.slice(0,from).join(" "),moves:all.slice(from,to).join(" ")};
})).concat([

  {
    id: 'jowa-1835',
    title: '吐血之局 · 三妙手',
    subtitle: '本因坊丈和 × 赤星因彻 · 1835',
    black: '赤星因彻',
    white: '本因坊丈和',
    intro: '复盘前 80 手，试着找出丈和在中盘的方向。',
    source: 'https://github.com/gilbert/games.shidogo/blob/master/sgf/blood_vomit.sgf',
    moves: 'cp pq qd ed oc eq qo qk qi op iq dn ep dp do dq co eo fp cq bq br cm gr hp en bp ck dl dk el gn cr dr bs fq go ar hn gm hm gl ek hl di io ho fo ch cd lq pn gc qn dc cc ec cf il gp nq ic fd lc bg bf af bi dj eh fj qg oi qe pd nf ok pk ol pj'
  },
  {
    id: 'alphago-2016-5',
    title: '人机大战 · 第五局',
    subtitle: '李世石 × AlphaGo · 2016',
    black: '李世石',
    white: 'AlphaGo',
    intro: '精选前 60 手，观察角部与全局的取舍。',
    source: 'https://github.com/benjaminmantle/baduk-study-material/blob/master/10-whole-games/ai-era/alphago-vs-lee-sedol-2016/2016.03.15-AlphaGo-Lee_Sedol.sgf',
    moves: 'qd dd pq dp oc po qo qn qp pm nq qe pe qf rd pf ql oe pl ol om ok nm qj rn gq cf fc bd ch dh di dg cc ci cj bi dj bh ml mm lm nl nk ln ll kn mn mo rm rl ro sn pn oo op no sm pp nc'
  }

]);
