import {readFile,writeFile} from 'node:fs/promises';
import {liveUploaderCatalog} from './music-core.mjs';

const projectUrl=new URL('../.music-studio/project.json',import.meta.url);
const playlistUrl=new URL('../public/music/playlist.json',import.meta.url);
try{
  const project=JSON.parse(await readFile(projectUrl,'utf8'));
  let data=JSON.parse(await readFile(playlistUrl,'utf8'));
  data=liveUploaderCatalog(project,data);
  data.updatedAt=new Date().toISOString();
  await writeFile(playlistUrl,JSON.stringify(data,null,2)+'\n');
  console.log(`Published ${data.playlists.length} live uploader playlists; no upload statistics or video archive generated.`);
}catch(error){
  console.error(error.code==='ENOENT'?'Local studio project or published playlist is missing. Run the studio and publish songs first.':error.message);
  process.exitCode=1;
}
