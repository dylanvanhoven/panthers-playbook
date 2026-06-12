// Panthers Playbook Sync v9
const https = require('https');
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const DB_URL = 'panthers-playbook-default-rtdb.firebaseio.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Netlify-CDN-Cache-Control': 'no-store'
};
 
function b64u(s){return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
 
async function getToken(){
  const now=Math.floor(Date.now()/1000);
  const h=b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const c=b64u(JSON.stringify({iss:CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now}));
  const crypto=require('crypto');
  const sign=crypto.createSign('RSA-SHA256');
  sign.update(`${h}.${c}`);
  const sig=sign.sign(PRIVATE_KEY,'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const jwt=`${h}.${c}.${sig}`;
  return new Promise((resolve,reject)=>{
    const body=`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req=https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},(res)=>{
      let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d).access_token);}catch(e){reject(new Error(d));}});
    });
    req.on('error',reject);req.write(body);req.end();
  });
}
 
function fb(method,token,path,body){
  return new Promise((resolve,reject)=>{
    const buf=body?Buffer.from(body):null;
    const opts={hostname:DB_URL,path:`${path}?access_token=${token}`,method,headers:{'Content-Type':'application/json'}};
    if(buf)opts.headers['Content-Length']=buf.length;
    const req=https.request(opts,(res)=>{
      let d='';res.on('data',c=>d+=c);
      res.on('end',()=>{resolve({status:res.statusCode,body:d});});
    });
    req.on('error',reject);
    if(buf)req.write(buf);
    req.end();
  });
}
 
exports.handler=async function(event){
  // Log every invocation to confirm function is running
  console.log('sync v9 called:', event.httpMethod, new Date().toISOString());
 
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:CORS,body:''};
  try{
    const token=await getToken();
    console.log('Token obtained OK');
 
    if(event.httpMethod==='GET'){
      const r=await fb('GET',token,'/playbook.json',null);
      const data=JSON.parse(r.body||'null')||{};
      console.log('GET playbook keys:', Object.keys(data));
      return{statusCode:200,headers:CORS,body:JSON.stringify({
        teams:data.teams||null,
        playerData:data.playerData||null,
        teamStats:data.teamStats||null,
        statsMetadata:data.statsMetadata||null
      })};
    }
 
    if(event.httpMethod==='POST'){
      const payload=JSON.parse(event.body);
      const isStats=payload._type==='stats';
      console.log('POST isStats:', isStats, 'bodySize:', event.body.length);
 
      if(isStats){
        const statsData={teamStats:payload.teamStats,statsMetadata:payload.statsMetadata};
        const teams=Object.keys(payload.teamStats||{});
        console.log('Writing stats for teams:', teams);
        teams.forEach(t=>console.log('Team',t,'players:',Object.keys((payload.teamStats||{})[t]||{}).length));
        const r=await fb('PATCH',token,'/playbook.json',JSON.stringify(statsData));
        console.log('Stats PATCH status:', r.status, 'response:', r.body.substring(0,50));
        return{statusCode:200,headers:CORS,body:JSON.stringify({ok:true,isStats:true,status:r.status})};
      } else {
        const patch={teams:payload.teams,playerData:payload.playerData};
        const r=await fb('PATCH',token,'/playbook.json',JSON.stringify(patch));
        console.log('Roster PATCH status:', r.status);
        return{statusCode:200,headers:CORS,body:JSON.stringify({ok:true,isStats:false,status:r.status})};
      }
    }
    return{statusCode:405,headers:CORS,body:'{"error":"Method not allowed"}'};
  }catch(e){
    console.error('Error:', e.message);
    return{statusCode:500,headers:CORS,body:JSON.stringify({error:e.message})};
  }
};
