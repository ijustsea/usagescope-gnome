export const MAX_FRAME_BYTES=1024*1024;
export const MAX_INPUT_BYTES=256*1024;
const METHODS=new Set(['initialize','account/read','account/rateLimits/read','account/login/start','account/login/cancel']);
export function rpcAllowed(method:string):boolean {return METHODS.has(method);}
export function validateAuthUrl(uri:unknown):string {
 if(typeof uri!=='string'||uri.length>16384||!/^https:\/\/(?:auth\.openai\.com|chatgpt\.com)(?::443)?(?:[/?#][^\s\\]*)?$/i.test(uri)||/[\u0000-\u0020\u007f\\]/.test(uri)) throw new Error('Untrusted authentication URL');
 return uri;
}
export function validateExecutable(path:unknown):string {
 if(typeof path!=='string'||!/^\/(?:[^\s\u0000-\u001f;|`$<>])*$/u.test(path)||path.length>4096||path==='/'||path.includes('/../')) throw new Error('Choose an absolute CLI executable path without shell syntax');
 return path;
}
