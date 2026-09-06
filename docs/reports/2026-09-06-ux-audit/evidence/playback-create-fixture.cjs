const fs=require('fs'), path=require('path'), assert=require('assert/strict');
(async()=>{
const schema=await import(require('url').pathToFileURL(path.join(process.cwd(),'shared/playlist-schema.js')).href);
const ordering=await import(require('url').pathToFileURL(path.join(process.cwd(),'renderer/scripts/modules/playlist-ordering.js')).href);
const folder=path.join(process.env.TEMP,'baeframe-ux-20260906');
const playlist=schema.createDefaultPlaylistData({name:'UX 감사 · A/B/C 3초 이어보기',userName:'UX audit'});
playlist.settings=ordering.normalizePlaylistSettings(playlist);
playlist.settings.continuous.loop=true;
playlist.settings.continuous.manualOrder=true;
playlist.items=['A','B','C'].map((letter,index)=>{
const videoPath=path.join(folder,`review-${letter}-3s.mp4`); assert(fs.existsSync(videoPath));
return {...schema.createPlaylistItem(videoPath),order:index,duration:3,fps:24,modifiedAtMs:fs.statSync(videoPath).mtimeMs};
});
const validation=schema.validatePlaylistData(playlist); assert.equal(validation.valid,true,JSON.stringify(validation));
const output=path.join(folder,'sample-review.bplaylist');
fs.writeFileSync(output,JSON.stringify(playlist,null,2));
console.log(JSON.stringify({output,validation,items:playlist.items.map(i=>i.fileName),settings:playlist.settings,note:'Automatic playback and concatenated-timeline mode must be enabled in app UI; these are not persisted by current playlist settings normalizer.'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

