'use strict';
const {randomUUID}=require('node:crypto');const {normaliseLibrary}=require('./store.cjs');
function mergeTransferredLibrary(engine,data){
  if(!data||!Array.isArray(data.tracks)||!Array.isArray(data.playlists))throw new Error('链接没有包含 MixTunes 歌单');
  const source=normaliseLibrary(data),byKey=new Map(source.tracks.map(t=>[t.key,t]));
  const result={added:0,existingKey:0,duplicateMetadata:0,playlistsCreated:0,playlistsMerged:0};
  engine.syncActivePlaylist();
  for(const imported of source.playlists){
    let target=engine.state.playlists.find(p=>imported.id!=='default'&&p.id===imported.id)||engine.state.playlists.find(p=>p.name===imported.name)||engine.state.playlists.find(p=>p.name===imported.name+'（导入）');
    if(!target){target={id:randomUUID(),name:imported.name,queue:[],mode:imported.mode,currentKey:null};engine.state.playlists.push(target);result.playlistsCreated++;}else result.playlistsMerged++;
    const added=engine.addTracksToPlaylist(imported.queue.map(k=>byKey.get(k)).filter(Boolean),target.id,false);
    for(const key of ['added','existingKey','duplicateMetadata'])result[key]+=added[key];
  }
  engine.publish(true);return result;
}
module.exports={mergeTransferredLibrary};
