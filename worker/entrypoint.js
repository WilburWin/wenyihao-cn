import {WorkerEntrypoint} from 'cloudflare:workers';
import {createMusicSiteSupport} from './music-site-support.js';
export {default,GameRoom,Guestbook} from './index.js';

export class MusicSiteSupport extends WorkerEntrypoint {
  configuration(){return createMusicSiteSupport(this.env).configuration();}
  seal(payload,origin,purpose){return createMusicSiteSupport(this.env).seal(payload,origin,purpose);}
  open(token,origin,purpose){return createMusicSiteSupport(this.env).open(token,origin,purpose);}
  fetch(request){return createMusicSiteSupport(this.env).fetch(request);}
}
