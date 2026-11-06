export function allowedGameOrigin(request,env={}){
  const origin=request.headers.get('Origin');
  const own=new URL(request.url).origin;
  return origin===own||Boolean(env.GAME_SITE_ORIGIN&&origin===env.GAME_SITE_ORIGIN);
}
