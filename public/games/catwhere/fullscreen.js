// Keep all controls available, with the board as the central layout landmark.
const layout=document.querySelector('.main-layout');
const game=document.querySelector('.game-area');
const tools=document.createElement('aside');tools.className='game-sidebar';tools.setAttribute('aria-label','游戏设置与操作');
for(const selector of ['.game-topline','.board-heading','.board-bottom','.controls','.game-message','.input-tip']){
 const node=game.querySelector(selector);if(node)tools.append(node);
}
layout.append(tools);
