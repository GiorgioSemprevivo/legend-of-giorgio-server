import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const TICK_RATE = 30;
const SNAPSHOT_RATE = 20;
const W = 512, H = 320, PI = Math.PI;
const ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_ROOMS = 500;

const biomeRows=[['coast','marsh','marsh','coast','cliff'],['forest','forest','meadow','dunes','dunes'],['forest','river','village','river','orchard'],['pasture','meadow','farm','orchard','meadow'],['hollow','forest','garden','ruins','cliff']];
const bossDefs=[
  {zx:0,zy:1,name:'THORNVINE STAG',ticket:'Ticket of Roots',color:'#a2e785',hp:5,kind:'stag'},
  {zx:2,zy:0,name:'GLASSWING SERPENT',ticket:'Ticket of Tides',color:'#8ce6ed',hp:6,kind:'serpent'},
  {zx:4,zy:1,name:'CINDER LION',ticket:'Ticket of Ember',color:'#ffc168',hp:6,kind:'lion'},
  {zx:0,zy:4,name:'HOLLOW MOTH',ticket:'Ticket of Echoes',color:'#dfaff2',hp:5,kind:'moth'},
  {zx:2,zy:4,name:'PEARL WARDEN',ticket:'Ticket of Dawn',color:'#b0f3cb',hp:6,kind:'warden'},
  {zx:4,zy:4,name:'ASTRAL WYVERN',ticket:'Ticket of Stars',color:'#cab7ff',hp:7,kind:'wyvern'}
];
const homeHouse={x:218,y:69,w:111,h:104,doorX:274,doorY:166};
const buildings=[{x:65,y:54,w:112,h:100,id:'bakery',name:'MARA’S BAKERY'},{x:339,y:52,w:111,h:102,id:'archive',name:'ADA’S RELIC SHOP'}];
const npcData=[
  {zx:2,zy:2,x:252,y:195,n:'SIR ROWAN',lines:['Giorgio is beyond the veil. Six ancient tickets power the Circle of Return.','Their guardians wait in the canopy, marsh, dunes, hollow, gardens, and cliffs.','Press M for your map. Return when all six tickets shine.']},
  {zx:2,zy:2,x:427,y:211,n:'MARA',lines:['Fresh rolls are ready. Even a questing mother needs breakfast.','Grandma called them wishing tickets. I only know people became wary of their power.']},
  {zx:2,zy:2,x:72,y:212,n:'ADA',lines:['I keep the roads marked. The bridges west and east will carry you over the rivers.','My brother keeps moving the signposts. I think he enjoys watching me fix the map.']},
  {zx:2,zy:3,x:133,y:243,n:'ELIO',lines:['Morning! I fed the cows while you were inside. Dylan tried to eat my hat.','Your boy came through here yesterday with ten dollars and a very strange idea.']},
  {zx:1,zy:1,x:177,y:224,n:'FEN',lines:['The stag was a kind forest spirit before the dark bargain disturbed it.','I have another three fences to repair, so I hope you forgive me for staying here.']},
  {zx:3,zy:1,x:355,y:227,n:'JUN',lines:['The hot road leads east. Watch for sparks around the old lion.','Business is decent. I would prefer fewer monsters near the customers.']},
  {zx:1,zy:0,x:117,y:203,n:'NELL',lines:['The serpent has turned the marsh waters to glass. I cannot cast a line there now.','When you see Giorgio, remind him he still owes me help mending a net.']},
  {zx:1,zy:4,x:371,y:221,n:'TOMAS',lines:['The tickets can make someone agree to almost anything. That is why they were sealed.','Old magic asks for courage. The tickets will only open a path home when reunited freely.']},
  {zx:3,zy:3,x:202,y:225,n:'PIP',lines:['I saw a shadow fly over the cliffs, and I dropped every berry I had.','If you go up there, will you tell me whether the stars are really that bright?']},
  {zx:0,zy:3,x:388,y:219,n:'BEA',lines:['The cows make better company than the hollow moth.','I still remember Giorgio sharing smoothies with your family on hot afternoons.','I was making a scarf for Giorgio. I will finish it before you bring him back.']}
];
const cows=[{x:57,y:108,name:'Dylan'},{x:424,y:225,name:'Mama Heifer'},{x:77,y:253,name:'Snooki'},{x:141,y:212,name:'Cow'}];
const interiorNPCs={
  bakery:{x:390,y:171,n:'MARA',lines:['These loaves will rise whether or not the sun does. Want one for the road?','I can sell you warm bread for 12 coins. Press B to eat it and restore a heart.']},
  archive:{x:387,y:171,n:'ADA',lines:['I polish old maps, lost relics, and one very bright wand.','A light wand costs 60 coins. Press F to fire a strong ball of light once it is yours.']}
};

const rooms = new Map();
const clamp=(a,l,h)=>Math.max(l,Math.min(h,a));
const sq=(x,y)=>x*x+y*y;
const hash=(x,y,s=0)=>{let v=Math.sin(x*127.1+y*311.7+s*78.233)*43758.5453;return v-Math.floor(v)};
const choice=(a,i)=>a[(i%a.length+a.length)%a.length];

function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let attempts=0;attempts<50;attempts++){
    let code=''; for(let i=0;i<5;i++) code+=chars[crypto.randomInt(chars.length)];
    if(!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').slice(0,5).toUpperCase();
}
function newPlayer(id){return {id,name:id===0?'MOM':'ALLY',token:crypto.randomBytes(18).toString('hex'),x:id===0?184:216,y:id===0?136:148,zoneX:2,zoneY:3,interior:'home',returnZone:null,dir:0,hp:3,bread:0,wand:false,inv:0,cool:0,swing:0,walk:false,step:0,input:{up:false,down:false,left:false,right:false},connected:true,lastSeq:0};}
function makeRoom(code){
  return {code,createdAt:Date.now(),lastActive:Date.now(),stage:'lobby',introIndex:0,players:[null,null],hostId:0,collected:0,coins:0,score:0,world:new Map(),bosses:bossDefs.map((b,i)=>({...b,i,x:265,y:160,full:b.hp,alive:true,cool:1.6,phase:0,hurt:0,deadFx:0})),finalBoss:{name:'THE BARGAINER',x:256,y:145,hp:36,full:36,alive:false,cool:.75,phase:0,hurt:0,attack:0},shots:[],heroShots:[],stageTime:0,snapshotAcc:0,clients:new Map()};
}
function resetRoom(room){
  room.stage='lobby';room.introIndex=0;room.collected=0;room.coins=0;room.score=0;room.world=new Map();room.bosses=bossDefs.map((b,i)=>({...b,i,x:265,y:160,full:b.hp,alive:true,cool:1.6,phase:0,hurt:0,deadFx:0}));room.finalBoss={name:'THE BARGAINER',x:256,y:145,hp:36,full:36,alive:false,cool:.75,phase:0,hurt:0,attack:0};room.shots=[];room.heroShots=[];room.stageTime=0;
  for(let i=0;i<2;i++) if(room.players[i]){const connected=room.players[i].connected,token=room.players[i].token;room.players[i]=newPlayer(i);room.players[i].connected=connected;room.players[i].token=token;}
}
function makeZone(room,x,y){
  const key=`${x},${y}`; if(room.world.has(key)) return room.world.get(key);
  const type=biomeRows[y][x],bushes=[],trees=[],enemies=[];
  const density={forest:50,marsh:22,coast:18,cliff:17,dunes:9,meadow:26,river:20,village:14,orchard:36,pasture:17,farm:19,hollow:29,garden:24,ruins:14}[type]||20;
  for(let i=0;i<density*2;i++){
    let xx=22+hash(i,x+y*5,17)*468,yy=37+hash(i,2+x*7+y*3,83)*245;
    if(Math.abs(xx-256)<66||Math.abs(yy-158)<45)continue;if(type==='village'&&xx>45&&xx<470&&yy<174)continue;if(type==='farm'&&xx>198&&xx<342&&yy<192)continue;if(type==='river'&&xx>205&&xx<310)continue;if(room.bosses.some(b=>b.zx===x&&b.zy===y)&&sq(xx-265,yy-160)<105*105)continue;
    if(trees.length<density)trees.push({x:xx,y:yy});else if(bushes.length<Math.ceil(density*.55))bushes.push({x:xx,y:yy,alive:true});
  }
  for(let i=0;i<Math.ceil(density*.8)*3;i++){
    let xx=22+hash(i,x+y*7,211)*468,yy=43+hash(i,x*3+y,212)*248;
    if(Math.abs(xx-256)<55||Math.abs(yy-158)<38)continue;if(type==='village'&&yy<175)continue;if(type==='farm'&&xx>198&&xx<342&&yy<192)continue;if(type==='river'&&xx>204&&xx<312)continue;if(room.bosses.some(b=>b.zx===x&&b.zy===y)&&sq(xx-265,yy-160)<91*91)continue;if(trees.some(t=>sq(t.x-xx,t.y-yy)<22*22))continue;if(bushes.some(b=>sq(b.x-xx,b.y-yy)<18*18))continue;if(bushes.length<Math.ceil(density*.6))bushes.push({x:xx,y:yy,alive:true});
  }
  if(type!=='village'&&type!=='farm'){
    const amount=['forest','hollow','ruins','marsh','dunes','cliff'].includes(type)?4:2;
    for(let i=0;i<amount;i++){
      let ex=88+hash(i,x*7+y,111)*335,ey=70+hash(i,y*7+x,112)*185;if(sq(ex-256,ey-160)<95*95)ex+=100;
      enemies.push({id:`${key}:${i}`,x:clamp(ex,36,476),y:ey,baseX:ex,baseY:ey,kind:choice(type==='dunes'?['ember','scarab']:type==='hollow'?['wisp','bat']:type==='marsh'?['slime','wisp']:type==='cliff'?['bat','scarab']:['slime','scout'],i),hp:2,alive:true,t:hash(i,x,8)*6,hurt:0});
    }
  }
  const zone={type,trees,bushes,enemies};room.world.set(key,zone);return zone;
}
function waterAt(x,y,zx,zy){const type=biomeRows[zy][zx];if(type==='river')return x>217&&x<298&&!(y>126&&y<190);if(zx===2&&zy===4)return y>90&&y<132&&!(x>210&&x<305);if(type==='marsh'&&!(zx===2&&zy===0))return ((x<120&&y>200)||(x>372&&y<100));return false;}
function solidAt(room,p,x,y){if(x<8||y<30||x>W-8||y>H-8)return false;const z=makeZone(room,p.zoneX,p.zoneY);for(const t of z.trees)if(sq(x-t.x,y-(t.y-2))<11*11)return true;const buildingsHere=p.zoneX===2&&p.zoneY===2?buildings:p.zoneX===2&&p.zoneY===3?[homeHouse]:[];for(const b of buildingsHere)if(x>b.x+3&&x<b.x+b.w-3&&y>b.y+19&&y<b.y+b.h-2)return true;return false;}
function send(ws,obj){if(ws?.readyState===1)ws.send(JSON.stringify(obj));}
function broadcast(room,obj){const payload=JSON.stringify(obj);for(const ws of room.clients.values())if(ws.readyState===1)ws.send(payload);}
function event(room,playerId,eventName,data={}){send(room.clients.get(playerId),{type:'event',event:eventName,...data});}
function setStage(room,stage){room.stage=stage;room.stageTime=0;room.lastActive=Date.now();broadcast(room,{type:'stage',stage});}
function startGame(room){if(room.players.filter(Boolean).length<2)return;room.stage='intro';room.introIndex=0;room.stageTime=0;broadcast(room,{type:'stage',stage:'intro',introIndex:0});}
function startFinalBoss(room){
  room.stage='finalboss';room.stageTime=0;room.shots=[];room.heroShots=[];Object.assign(room.finalBoss,{x:256,y:137,hp:room.finalBoss.full,alive:true,cool:.75,phase:0,hurt:0,attack:0});
  const positions=[[226,275],[286,275]];for(let i=0;i<2;i++){const p=room.players[i];if(!p)continue;p.zoneX=2;p.zoneY=2;p.interior=null;p.x=positions[i][0];p.y=positions[i][1];p.dir=2;p.inv=1;p.cool=0;p.swing=0;p.input={up:false,down:false,left:false,right:false};}
  broadcast(room,{type:'event',event:'boss_start'});
}
function finishFinalBoss(room){if(!room.finalBoss.alive)return;room.finalBoss.alive=false;room.score+=5000;room.shots=[];room.heroShots=[];room.stage='bossdeath';room.stageTime=0;broadcast(room,{type:'event',event:'boss_die'});}
function hurtPlayer(room,p){if(p.inv>0)return;p.hp--;p.inv=1.2;if(p.hp<=0){p.hp=3;p.inv=2;p.x=room.stage==='finalboss'?256:256;p.y=room.stage==='finalboss'?278:(p.interior?242:255);}event(room,p.id,'hurt',{hp:p.hp});}
function movePlayer(room,p,dt){
  let mx=(p.input.right?1:0)-(p.input.left?1:0),my=(p.input.down?1:0)-(p.input.up?1:0),len=Math.hypot(mx,my)||1;p.walk=!!(mx||my);if(!p.walk)return;mx/=len;my/=len;p.dir=Math.abs(mx)>Math.abs(my)?(mx>0?3:1):(my>0?0:2);p.step+=dt*12;
  if(room.stage==='finalboss'){const speed=p.swing>0?80:115;p.x=clamp(p.x+mx*speed*dt,32,480);p.y=clamp(p.y+my*speed*dt,88,295);return;}
  if(p.interior){const speed=p.swing>0?78:112;p.x=clamp(p.x+mx*speed*dt,33,479);p.y=clamp(p.y+my*speed*dt,69,305);return;}
  const wading=waterAt(p.x,p.y+5,p.zoneX,p.zoneY),speed=(p.swing>0?78:112)*(wading?.56:1),xx=p.x+mx*speed*dt,yy=p.y+my*speed*dt;
  if(!solidAt(room,p,xx,p.y+5))p.x=xx;if(!solidAt(room,p,p.x,yy+5))p.y=yy;
  if(p.x<8)zoneShift(room,p,-1,0);else if(p.x>504)zoneShift(room,p,1,0);else if(p.y<34)zoneShift(room,p,0,-1);else if(p.y>311)zoneShift(room,p,0,1);
}
function zoneShift(room,p,dx,dy){const nx=p.zoneX+dx,ny=p.zoneY+dy;if(nx<0||ny<0||nx>4||ny>4){p.x=clamp(p.x,12,500);p.y=clamp(p.y,37,306);return;}p.zoneX=nx;p.zoneY=ny;p.x=dx>0?13:dx<0?499:p.x;p.y=dy>0?40:dy<0?305:p.y;event(room,p.id,'zone',{zoneX:nx,zoneY:ny});}
function playersInZone(room,zx,zy){return room.players.filter(p=>p&&p.connected&&!p.interior&&p.zoneX===zx&&p.zoneY===zy);}
function nearestPlayer(players,x,y){let best=null,bd=Infinity;for(const p of players){const d=Math.hypot(p.x-x,p.y-y);if(d<bd){bd=d;best=p}}return [best,bd];}
function enemyReward(kind){return kind==='scout'?7:kind==='ember'||kind==='wisp'?8:5;}
function defeatEnemy(room,e){if(!e.alive)return;e.alive=false;room.coins+=enemyReward(e.kind);room.score+=100;broadcast(room,{type:'event',event:'enemy_down',x:e.x,y:e.y,coins:room.coins,score:room.score});}
function defeatBoss(room,b){if(!b.alive)return;b.alive=false;b.deadFx=1.8;room.coins+=25;room.score+=1000;room.shots=room.shots.filter(s=>!(s.zoneX===b.zx&&s.zoneY===b.zy));broadcast(room,{type:'event',event:'guardian_down',bossIndex:b.i});}
function sword(room,p){if(p.cool>0||!['play','finalboss'].includes(room.stage))return;p.cool=.31;p.swing=.24;const d=[[0,1],[-1,0],[0,-1],[1,0]][p.dir],hx=p.x+d[0]*29,hy=p.y+d[1]*29;
  if(room.stage==='finalboss'){if(room.finalBoss.alive&&sq(room.finalBoss.x-hx,room.finalBoss.y-hy)<60*60){room.finalBoss.hp--;room.finalBoss.hurt=.22;if(room.finalBoss.hp<=0)finishFinalBoss(room);}return;}
  if(p.interior)return;const z=makeZone(room,p.zoneX,p.zoneY);
  for(const b of z.bushes)if(b.alive&&sq(b.x-hx,b.y-hy)<30*30){b.alive=false;break;}
  for(const e of z.enemies)if(e.alive&&sq(e.x-hx,e.y-hy)<31*31){e.hp--;e.hurt=.25;if(e.hp<=0)defeatEnemy(room,e);break;}
  const boss=room.bosses.find(b=>b.zx===p.zoneX&&b.zy===p.zoneY&&b.alive);if(boss&&sq(boss.x-hx,boss.y-hy)<56*56){boss.hp--;boss.hurt=.25;if(boss.hp<=0)defeatBoss(room,boss);}
}
function castWand(room,p){if(!p.wand||p.cool>0||p.interior||!['play','finalboss'].includes(room.stage))return;p.cool=.22;const d=[[0,1],[-1,0],[0,-1],[1,0]][p.dir];room.heroShots.push({id:crypto.randomUUID(),owner:p.id,zoneX:p.zoneX,zoneY:p.zoneY,x:p.x+d[0]*20,y:p.y-16+d[1]*16,vx:d[0]*220,vy:d[1]*220,life:1.4});}
function eatBread(room,p){if(p.bread<1||p.hp>=3||!['play','finalboss'].includes(room.stage))return;p.bread--;p.hp=Math.min(3,p.hp+1);event(room,p.id,'message',{text:'Warm bread restores one heart.'});}
function nearObj(p,o,dist=37){return Math.hypot(p.x-o.x,p.y-o.y)<dist;}
function findInteraction(room,p){
  let best=null,bd=37;const consider=(o,type)=>{const d=Math.hypot(p.x-o.x,p.y-o.y);if(d<bd){bd=d;best={...o,type}}};
  if(p.interior){
    if(p.y>278&&Math.abs(p.x-256)<65)consider({x:256,y:303},'exit');
    if(p.interior==='home'){consider({x:112,y:114},'photo');consider({x:389,y:188},'journal');}
    else if(p.interior==='bakery'){consider(interiorNPCs.bakery,'npc');consider({x:253,y:214,item:'bread'},'shop');}
    else if(p.interior==='archive'){consider(interiorNPCs.archive,'npc');consider({x:257,y:215,item:'wand'},'shop');}
    return best;
  }
  if(p.zoneX===2&&p.zoneY===3)consider({x:274,y:187},'home');
  if(p.zoneX===2&&p.zoneY===2)for(const b of buildings)consider({x:b.x+b.w/2,y:b.y+b.h+13,id:b.id},'door');
  for(const n of npcData)if(n.zx===p.zoneX&&n.zy===p.zoneY)consider(n,'npc');
  const bi=room.bosses.find(b=>b.zx===p.zoneX&&b.zy===p.zoneY);if(bi&&!bi.alive&&!(room.collected&(1<<bi.i)))consider({x:265,y:160,i:bi.i},'ticket');
  if(p.zoneX===2&&p.zoneY===3)for(const cow of cows)consider(cow,'cow');
  return best;
}
function interact(room,p){if(room.stage!=='play')return;const o=findInteraction(room,p);if(!o)return;
  if(o.type==='exit'){const old=p.interior;p.interior=null;if(p.returnZone){p.zoneX=p.returnZone.x;p.zoneY=p.returnZone.y;}p.returnZone=null;p.x=old==='home'?274:old==='bakery'?121:395;p.y=old==='home'?188:164;event(room,p.id,'transition');return;}
  if(o.type==='home'){p.returnZone={x:2,y:3};p.interior='home';p.x=256;p.y=242;event(room,p.id,'transition');return;}
  if(o.type==='door'){p.returnZone={x:p.zoneX,y:p.zoneY};p.interior=o.id;p.x=256;p.y=246;event(room,p.id,'transition');return;}
  if(o.type==='photo'){event(room,p.id,'dialogue',{lines:[{who:'MOM',text:'Eight children in one picture. Giorgio managed to make a funny face just as it was taken.'},{who:'MOM',text:'I am bringing you home, sweetheart.'}]});return;}
  if(o.type==='journal'){event(room,p.id,'dialogue',{lines:[{who:'JOURNAL',text:'Giorgio: Missing. Last seen accepting ten dollars from a shadowy stranger. Six tickets needed to open the way back.'}]});return;}
  if(o.type==='cow'){event(room,p.id,'dialogue',{lines:[{who:o.name.toUpperCase()+' THE COW',text:'Moooo! '+o.name+' leans into your hand, then goes right back to the grass.'}]});return;}
  if(o.type==='shop'){
    if(o.item==='bread'){if(room.coins<12){event(room,p.id,'message',{text:'Need 12 coins for a fresh loaf.'});return;}room.coins-=12;p.bread++;event(room,p.id,'message',{text:'Bought bread · Press B to eat it later.'});return;}
    if(o.item==='wand'){if(p.wand){event(room,p.id,'message',{text:'The light wand is already yours.'});return;}if(room.coins<60){event(room,p.id,'message',{text:'Need 60 coins for the light wand.'});return;}room.coins-=60;p.wand=true;event(room,p.id,'dialogue',{lines:[{who:'ADA',text:'Handle it with care. That relic turns courage into light.'},{who:p.id===0?'MOM':'ALLY',text:'Perfect. Press F and the darkness is getting a surprise.'}]});return;}
  }
  if(o.type==='npc'){
    if(o.n==='SIR ROWAN'&&room.collected===63){event(room,p.id,'dialogue',{token:'finalboss',lines:[{who:'SIR ROWAN',text:'You have all six tickets... but something is wrong.'},{who:'SIR ROWAN',text:'The dark creature Giorgio made the ten-dollar deal with has come to stop you from bringing him back.'},{who:'SIR ROWAN',text:'Protect the tickets. Whatever comes through that darkness, do not let it reach the Circle of Return.'}]});return;}
    event(room,p.id,'dialogue',{lines:o.lines.map(text=>({who:o.n,text}))});return;
  }
  if(o.type==='ticket'){
    const b=room.bosses[o.i];if(room.collected&(1<<o.i))return;room.collected|=1<<o.i;event(room,p.id,'dialogue',{lines:[{who:b.ticket.toUpperCase(),text:'The ancient seal answers your courage. Its light joins the others.'},{who:p.id===0?'MOM':'ALLY',text:room.collected===63?'That is all six. Back to Sir Rowan in Hearthvale Village!':`${6-bitCount(room.collected)} more tickets. Giorgio, we are coming.`}]});broadcast(room,{type:'event',event:'ticket_collected',bossIndex:o.i,collected:room.collected});
  }
}
function bitCount(n){let k=0;while(n){k+=n&1;n>>=1}return k;}
function tickRoom(room,dt){room.lastActive=Date.now();room.stageTime+=dt;for(const b of room.bosses){b.hurt=Math.max(0,b.hurt-dt);b.deadFx=Math.max(0,b.deadFx-dt);}room.finalBoss.hurt=Math.max(0,room.finalBoss.hurt-dt);
  if(room.stage==='bossdeath'){if(room.stageTime>4.6){room.stage='ending';room.stageTime=0;room.shots=[];room.heroShots=[];for(let i=0;i<2;i++){const p=room.players[i];if(p){p.zoneX=2;p.zoneY=2;p.interior=null;p.x=210+i*34;p.y=214;p.dir=i===0?3:1;}}}return;}
  if(room.stage==='ending'){if(room.stageTime>43){room.stage='victory';room.stageTime=43;}return;}
  if(!['play','finalboss'].includes(room.stage))return;
  for(const p of room.players){if(!p||!p.connected)continue;p.inv=Math.max(0,p.inv-dt);p.cool=Math.max(0,p.cool-dt);p.swing=Math.max(0,p.swing-dt);movePlayer(room,p,dt);}
  if(room.stage==='finalboss')tickFinalBoss(room,dt);else tickWorld(room,dt);
}
function tickWorld(room,dt){
  const activeKeys=new Set(room.players.filter(p=>p&&p.connected&&!p.interior).map(p=>`${p.zoneX},${p.zoneY}`));
  for(const key of activeKeys){const [zx,zy]=key.split(',').map(Number),z=makeZone(room,zx,zy),players=playersInZone(room,zx,zy);for(const e of z.enemies){if(!e.alive)continue;e.t+=dt;e.hurt=Math.max(0,e.hurt-dt);const [target,d]=nearestPlayer(players,e.x,e.y);if(!target)continue;if(d<106&&d>18){const sp=e.kind==='bat'?34:23,xx=e.x+(target.x-e.x)/d*sp*dt,yy=e.y+(target.y-e.y)/d*sp*dt;if(!waterAt(xx,yy,zx,zy)){e.x=xx;e.y=yy}}else{e.x+=Math.sin(e.t*1.2)*dt*6;e.y+=Math.cos(e.t*.9)*dt*4}for(const p of players)if(Math.hypot(p.x-e.x,p.y-e.y)<19)hurtPlayer(room,p)}
    const b=room.bosses.find(b=>b.zx===zx&&b.zy===zy&&b.alive);if(b&&players.length){b.phase+=dt;b.cool-=dt;const [target,d]=nearestPlayer(players,b.x,b.y);if(target&&d<190&&b.cool<=0){b.cool=b.kind==='wyvern'?1.25:1.75;const a=Math.atan2(target.y-b.y,target.x-b.x),count=b.kind==='wyvern'?3:2;for(let i=0;i<count;i++){const ang=a+(i-(count===3?1:.5))*.27;room.shots.push({id:crypto.randomUUID(),zoneX:zx,zoneY:zy,x:b.x,y:b.y,vx:Math.cos(ang)*82,vy:Math.sin(ang)*82,life:3,color:b.color,big:false});}}for(const p of players)if(Math.hypot(p.x-b.x,p.y-b.y)<28)hurtPlayer(room,p);}
  }
  updateShots(room,dt,false);updateHeroShots(room,dt,false);
}
function tickFinalBoss(room,dt){const b=room.finalBoss;if(!b.alive)return;b.phase+=dt;b.x=256+Math.sin(b.phase*.72)*76;b.y=136+Math.sin(b.phase*1.37)*16;b.cool-=dt;const players=room.players.filter(p=>p&&p.connected);if(b.cool<=0&&players.length){b.attack++;b.cool=b.hp<b.full*.45?.48:.68;const [target]=nearestPlayer(players,b.x,b.y);if(target){const a=Math.atan2(target.y-b.y,target.x-b.x);if(b.attack%4===0){for(let i=0;i<10;i++){const ang=i*PI/5+b.phase*.2;room.shots.push({id:crypto.randomUUID(),zoneX:2,zoneY:2,x:b.x,y:b.y,vx:Math.cos(ang)*96,vy:Math.sin(ang)*96,life:4,color:'#8c4ab0',big:true,final:true});}}else{for(let i=-2;i<=2;i++){const ang=a+i*.16;room.shots.push({id:crypto.randomUUID(),zoneX:2,zoneY:2,x:b.x,y:b.y,vx:Math.cos(ang)*120,vy:Math.sin(ang)*120,life:3.2,color:i===0?'#d06ce4':'#6d3d81',big:i===0,final:true});}}}}
  for(const p of players)if(Math.hypot(p.x-b.x,p.y-b.y)<43)hurtPlayer(room,p);updateShots(room,dt,true);updateHeroShots(room,dt,true);
}
function updateShots(room,dt,isFinal){for(const s of room.shots){s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;if(s.life<=0)continue;for(const p of room.players){if(!p||!p.connected||p.interior)continue;if(isFinal||(!s.final&&p.zoneX===s.zoneX&&p.zoneY===s.zoneY)){const r=s.big?16:12;if(sq(p.x-s.x,p.y-s.y)<r*r){s.life=0;hurtPlayer(room,p);break;}}}}room.shots=room.shots.filter(s=>s.life>0&&s.x>-40&&s.x<W+40&&s.y>0&&s.y<H+40);}
function updateHeroShots(room,dt,isFinal){for(const s of room.heroShots){s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;if(s.life<=0)continue;if(isFinal){const b=room.finalBoss;if(b.alive&&sq(b.x-s.x,b.y-s.y)<52*52){s.life=0;b.hp-=2;b.hurt=.25;if(b.hp<=0)finishFinalBoss(room);}}else{const z=makeZone(room,s.zoneX,s.zoneY);for(const e of z.enemies){if(e.alive&&sq(e.x-s.x,e.y-s.y)<22*22){s.life=0;e.hp=0;defeatEnemy(room,e);break;}}const b=room.bosses.find(b=>b.zx===s.zoneX&&b.zy===s.zoneY&&b.alive);if(s.life>0&&b&&sq(b.x-s.x,b.y-s.y)<42*42){s.life=0;b.hp-=2;b.hurt=.25;if(b.hp<=0)defeatBoss(room,b);}}}room.heroShots=room.heroShots.filter(s=>s.life>0&&s.x>-20&&s.x<W+20&&s.y>20&&s.y<H+20);}
function serializeZone(z){return {type:z.type,bushes:z.bushes.map(b=>({x:r2(b.x),y:r2(b.y),alive:b.alive})),enemies:z.enemies.map(e=>({id:e.id,x:r2(e.x),y:r2(e.y),kind:e.kind,hp:e.hp,alive:e.alive,t:r2(e.t),hurt:r2(e.hurt)}))};}
function r2(n){return Math.round(n*100)/100;}
function snapshot(room){const zoneKeys=new Set();for(const p of room.players)if(p&&!p.interior)zoneKeys.add(`${p.zoneX},${p.zoneY}`);const zones={};for(const key of zoneKeys){const [x,y]=key.split(',').map(Number);zones[key]=serializeZone(makeZone(room,x,y));}
  return {type:'snapshot',serverTime:Date.now(),stage:room.stage,stageTime:r2(room.stageTime),introIndex:room.introIndex,collected:room.collected,coins:room.coins,score:room.score,players:room.players.map(p=>p?{id:p.id,name:p.name,x:r2(p.x),y:r2(p.y),zoneX:p.zoneX,zoneY:p.zoneY,interior:p.interior,dir:p.dir,hp:p.hp,bread:p.bread,wand:p.wand,inv:r2(p.inv),cool:r2(p.cool),swing:r2(p.swing),walk:p.walk,step:r2(p.step),connected:p.connected}:null),bosses:room.bosses.map(b=>({i:b.i,x:r2(b.x),y:r2(b.y),hp:b.hp,alive:b.alive,cool:r2(b.cool),phase:r2(b.phase),hurt:r2(b.hurt),deadFx:r2(b.deadFx)})),finalBoss:{...room.finalBoss,x:r2(room.finalBoss.x),y:r2(room.finalBoss.y),cool:r2(room.finalBoss.cool),phase:r2(room.finalBoss.phase),hurt:r2(room.finalBoss.hurt)},shots:room.shots.map(s=>({...s,x:r2(s.x),y:r2(s.y)})),heroShots:room.heroShots.map(s=>({...s,x:r2(s.x),y:r2(s.y)})),zones};}
function roomInfo(room){return {type:'room',roomCode:room.code,hostId:room.hostId,players:room.players.map(p=>p?{id:p.id,name:p.name,connected:p.connected}:null),stage:room.stage};}
function handleMessage(ws,data){let msg;try{msg=JSON.parse(data.toString())}catch{return}if(!msg||typeof msg!=='object')return;const now=Date.now();if(!ws.rate){ws.rate={t:now,n:0}}if(now-ws.rate.t>1000){ws.rate={t:now,n:0}}if(++ws.rate.n>80)return;
  if(msg.type==='create'){if(rooms.size>=MAX_ROOMS){send(ws,{type:'error',message:'Server room limit reached.'});return;}const code=roomCode(),room=makeRoom(code);rooms.set(code,room);room.players[0]=newPlayer(0);room.clients.set(0,ws);ws.roomCode=code;ws.playerId=0;send(ws,{type:'joined',roomCode:code,playerId:0,isHost:true,resumeToken:room.players[0].token});broadcast(room,roomInfo(room));return;}
  if(msg.type==='join'){const code=String(msg.roomCode||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5),room=rooms.get(code);if(!room){send(ws,{type:'error',message:'Room not found.'});return;}if(room.stage!=='lobby'){send(ws,{type:'error',message:'That game has already started.'});return;}const slot=(!room.players[1]||!room.players[1].connected)?1:null;if(slot===null){send(ws,{type:'error',message:'Room is full.'});return;}room.players[1]=newPlayer(1);room.clients.set(1,ws);ws.roomCode=code;ws.playerId=1;send(ws,{type:'joined',roomCode:code,playerId:1,isHost:false,resumeToken:room.players[1].token});broadcast(room,roomInfo(room));return;}
  if(msg.type==='resume'){const code=String(msg.roomCode||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5),room=rooms.get(code),token=String(msg.resumeToken||'');if(!room){send(ws,{type:'error',message:'Room no longer exists.'});return;}const p=room.players.find(q=>q&&q.token===token);if(!p){send(ws,{type:'error',message:'Resume token is invalid for this room.'});return;}if(p.connected&&room.clients.has(p.id)){send(ws,{type:'error',message:'That player is already connected.'});return;}p.connected=true;room.clients.set(p.id,ws);ws.roomCode=code;ws.playerId=p.id;send(ws,{type:'joined',roomCode:code,playerId:p.id,isHost:p.id===room.hostId,resumeToken:p.token,resumed:true});broadcast(room,roomInfo(room));send(ws,snapshot(room));return;}
  const room=rooms.get(ws.roomCode);if(!room||ws.playerId==null)return;const p=room.players[ws.playerId];if(!p)return;room.lastActive=Date.now();
  if(msg.type==='start'){if(ws.playerId===room.hostId&&room.stage==='lobby'&&room.players[0]&&room.players[1])startGame(room);return;}
  if(msg.type==='advance_intro'){if(ws.playerId!==room.hostId||room.stage!=='intro')return;if(room.introIndex<3){room.introIndex++;broadcast(room,{type:'intro',introIndex:room.introIndex});}else{room.stage='play';room.stageTime=0;for(let i=0;i<2;i++){const q=room.players[i];if(q){q.zoneX=2;q.zoneY=3;q.interior='home';q.x=184+i*34;q.y=136+i*12;q.dir=0;}}broadcast(room,{type:'stage',stage:'play'});}return;}
  if(msg.type==='input'){if(typeof msg.seq==='number'&&msg.seq<p.lastSeq)return;p.lastSeq=Number(msg.seq)||p.lastSeq;p.input={up:!!msg.up,down:!!msg.down,left:!!msg.left,right:!!msg.right};return;}
  if(msg.type==='action'){if(msg.action==='sword')sword(room,p);else if(msg.action==='wand')castWand(room,p);else if(msg.action==='bread')eatBread(room,p);else if(msg.action==='interact')interact(room,p);else if(msg.action==='restart'&&ws.playerId===room.hostId&&room.stage==='victory'){resetRoom(room);broadcast(room,roomInfo(room));}return;}
  if(msg.type==='dialogue_complete'&&msg.token==='finalboss'&&room.stage==='play'&&room.collected===63){startFinalBoss(room);return;}
}

const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return;}res.writeHead(200,{'content-type':'text/plain','access-control-allow-origin':'*'});res.end('Legend of Giorgio co-op server is running.');});
const wss=new WebSocketServer({server,maxPayload:4096});
wss.on('connection',(ws)=>{send(ws,{type:'hello',protocol:1});ws.on('message',d=>handleMessage(ws,d));ws.on('close',()=>{const room=rooms.get(ws.roomCode);if(!room||ws.playerId==null)return;const p=room.players[ws.playerId];if(p)p.connected=false;room.clients.delete(ws.playerId);broadcast(room,roomInfo(room));room.lastActive=Date.now();});ws.on('error',()=>{});});
setInterval(()=>{const dt=1/TICK_RATE;for(const room of rooms.values()){tickRoom(room,dt);room.snapshotAcc+=dt;if(room.snapshotAcc>=1/SNAPSHOT_RATE){room.snapshotAcc=0;broadcast(room,snapshot(room));}}},1000/TICK_RATE);
setInterval(()=>{const now=Date.now();for(const [code,room] of rooms){const connected=[...room.clients.values()].some(ws=>ws.readyState===1);if(!connected&&now-room.lastActive>ROOM_TTL_MS)rooms.delete(code);}},60_000).unref();
server.listen(PORT,()=>console.log(`Legend of Giorgio co-op server listening on :${PORT}`));
