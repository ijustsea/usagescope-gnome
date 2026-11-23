export const MAX_FRAME_BYTES=1024*1024;
export const MAX_CONNECTION_BYTES=4*1024*1024;
export const MAX_CONNECTION_MESSAGES=256;
export const MAX_INPUT_BYTES=256*1024;
export function websiteUrl(provider:unknown):string {
 if(provider==='codex')return 'https://chatgpt.com/auth/login';
 if(provider==='claude')return 'https://claude.ai/login';
 throw new Error('Unknown provider');
}
// Read-only quota access. Sign-in stays in the official CLI's own terminal command.
const METHODS=new Set(['initialize','account/read','account/rateLimits/read']);
export function rpcAllowed(method:string):boolean {return METHODS.has(method);}
export function validateExecutable(path:unknown):string {
 if(typeof path!=='string'||!/^\/(?:[^\s\u0000-\u001f;|`$<>])*$/u.test(path)||path.length>4096||path==='/'||path.includes('/../')) throw new Error('Choose an absolute CLI executable path without shell syntax');
 return path;
}
