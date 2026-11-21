import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {validateExecutable} from '../core/policy.js';

/** Resolve links and check every directory before trusting an executable.
 * Same-UID code is trusted; a mutable path shared with other users is not.
 */
export function trustedExecutable(input:string):string {
 const uid=new Gio.Credentials().get_unix_user();
 let path=GLib.canonicalize_filename(validateExecutable(input),null);
 const attributes='standard::type,standard::is-symlink,standard::symlink-target,unix::mode,unix::uid,access::can-execute';
 for(let links=0;links<=16;links++) {
  const pieces=path.split('/').filter(Boolean);let prefix='';let redirected=false;
  for(let i=0;i<pieces.length;i++) {
   prefix+='/'+pieces[i];
   const info=Gio.File.new_for_path(prefix).query_info(attributes,Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null);
   const owner=info.get_attribute_uint32('unix::uid'), mode=info.get_attribute_uint32('unix::mode');
   if(owner!==0&&owner!==uid)throw new Error('CLI path is owned by another user');
   if(info.get_is_symlink()) {
    const target=info.get_symlink_target();if(!target)throw new Error('Invalid CLI symlink');
    const base=GLib.canonicalize_filename(target,GLib.path_get_dirname(prefix));
    path=GLib.canonicalize_filename([base,...pieces.slice(i+1)].join('/'),null);
    validateExecutable(path);redirected=true;break;
   }
   const directory=info.get_file_type()===Gio.FileType.DIRECTORY;
   const rootStickyDirectory=directory&&owner===0&&(mode&0o1000)!==0;
   if((mode&0o022)!==0&&!rootStickyDirectory)throw new Error('CLI path is writable by another user');
   if(i<pieces.length-1&&!directory)throw new Error('Invalid CLI parent directory');
   if(i===pieces.length-1&&(info.get_file_type()!==Gio.FileType.REGULAR||!info.get_attribute_boolean('access::can-execute')))throw new Error('CLI path is not executable');
  }
  if(!redirected)return path;
 }
 throw new Error('CLI symlink chain is too deep');
}
