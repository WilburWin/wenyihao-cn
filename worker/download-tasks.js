// A scoped capability redirects a local downloader to Baidu. No file bytes are fetched here.
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function issueDownloadTask(storage,grant,until){
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
  await storage.put('download-task:'+await hash(token),{...grant,until});
  return {token,expiresAt:until};
}
export async function readDownloadTask(storage,token,now=Date.now()){
  if(!/^[a-f0-9]{64}$/.test(token||''))return null;
  const grant=await storage.get('download-task:'+await hash(token));
  return grant?.until>now?grant:null;
}
