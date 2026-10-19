// Original procedural icon, kept reproducible without an image tool or native library.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
const size = 512;
const bytes = Buffer.alloc((size * 4 + 1) * size);
const chips = [[164,150,23],[330,189,25],[126,311,24],[270,374,25],[381,322,21]];
for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const dx=x-256,dy=y-250,r=Math.hypot(dx,dy),i=y*(size*4+1)+1+x*4;
  if(r>224) continue;
  const shade=Math.max(0,Math.min(1,(x+y)/1024));
  let color=[Math.round(245-shade*27),Math.round(203-shade*46),Math.round(128-shade*47),Math.round(Math.min(1,224-r)*255)];
  if(r>215) color=[191,133,62,color[3]];
  for(const [cx,cy,cr] of chips) if(Math.hypot(x-cx,y-cy)<cr)color=[99,64,44,255];
  if(Math.hypot((x-210)/1.0,(y-278)/1.5)<8 || Math.hypot((x-282)/1.0,(y-278)/1.5)<8) color=[101,67,47,255];
  if(y>302 && y<322 && Math.abs(Math.hypot(x-246,y-295)-25)<3)color=[101,67,47,255];
  bytes.set(color,i);
}
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
mkdirSync('assets',{recursive:true});
writeFileSync('assets/icon.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(bytes)),chunk('IEND',Buffer.alloc(0))]));
