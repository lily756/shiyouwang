/**
 * Character OS v2 — Browser Interactive Runtime Script
 * 提供浏览器端 React Native Web DOM 渲染、登录/注册/退出、Telegram 绑定码生成、SSE 实时同步与聊天工坊交互
 */

export function getBrowserClientScript(): string {
  return `export function h(t,s,p,...ch){
  const el=document.createElement({Text:'span',TouchableOpacity:'button',TextInput:'input',Image:'img'}[t]||'div');
  el.className='rn-'+t.toLowerCase()+(p?.className?' '+p.className:'');
  if(t==='TouchableOpacity')el.type='button';
  if(s)for(const[k,v]of Object.entries(s))el.style[k]=typeof v==='number'&&!['flex','opacity','zIndex','fontWeight'].includes(k)?v+'px':v;
  if(p)for(const[k,v]of Object.entries(p)){if(k==='style'||k==='className')continue;if(k==='value')el.value=v;else if(k==='placeholder')el.placeholder=v;else if(k==='src')el.src=v;else if(k==='type')el.type=v;else el.setAttribute(k,v);}
  for(const c of ch.flat(Infinity))if(c!=null&&c!==false)el.appendChild(typeof c==='object'&&c.nodeType?c:document.createTextNode(String(c)));
  return el;
}
const state={currentUser:null,authMode:'login',authError:'',bindCommand:'',characters:[],activeCharacterId:null,relationship:null,schedule:null,inventory:[],imprints:[],messages:[],mediaTasks:[],drawerOpen:true,studioModalOpen:false};
const getToken=()=>localStorage.getItem('cos_auth_token')||'';
const api=(p,o={})=>{
  const tk=getToken();
  const headers={'Content-Type':'application/json',...(tk?{'Authorization':'Bearer '+tk}:{}),...(o.headers||{})};
  return fetch(p,{...o,headers}).then(r=>r.json());
};
const fmt=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const inp=(id,ph,style={},extra={})=>h('TextInput',{backgroundColor:'#242f3d',color:'#fff',padding:'8px 12px',borderRadius:6,fontSize:13,...style},{id,placeholder:ph,...extra});

function renderAuthModal(s){
  const isReg=s.authMode==='register';
  return h('View',{position:'fixed',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(10,16,24,0.92)',display:'flex',justifyContent:'center',alignItems:'center',zIndex:200},null,
    h('View',{width:380,backgroundColor:'#17212b',borderRadius:12,padding:24,gap:14,border:'1px solid #242f3d'},null,
      h('Text',{color:'#fff',fontSize:20,fontWeight:'bold'},null,'Character OS v2'),
      h('Text',{color:'#7e8b99',fontSize:12},null,'多端同步活人感角色系统 · 请登录或注册账号'),
      h('View',{display:'flex',flexDirection:'row',gap:8},null,
        h('TouchableOpacity',{flex:1,padding:'8px 0',borderRadius:6,backgroundColor:!isReg?'#5288c1':'#242f3d',alignItems:'center'},{'data-action':'switch-auth-login'},h('Text',{color:'#fff',fontSize:13,fontWeight:'600'},null,'登录账号')),
        h('TouchableOpacity',{flex:1,padding:'8px 0',borderRadius:6,backgroundColor:isReg?'#5288c1':'#242f3d',alignItems:'center'},{'data-action':'switch-auth-register'},h('Text',{color:'#fff',fontSize:13,fontWeight:'600'},null,'注册新账号')),
      ),
      s.authError?h('View',{backgroundColor:'#3b1d26',padding:8,borderRadius:6},null,h('Text',{color:'#ff8a80',fontSize:12},null,'⚠️ '+s.authError)):null,
      inp('auth-username','用户名 (如: akira)',{padding:'10px 12px'}),
      isReg?inp('auth-displayname','角色对你的称呼 (默认: 主人)',{padding:'10px 12px'}):null,
      inp('auth-password','密码 (至少4位)',{padding:'10px 12px'},{type:'password'}),
      h('TouchableOpacity',{backgroundColor:'#5288c1',padding:'10px 12px',borderRadius:6,alignItems:'center'},{'data-action':isReg?'submit-register':'submit-login'},h('Text',{color:'#fff',fontSize:14,fontWeight:'bold'},null,isReg?'注册并进入世界':'立即登录')),
      h('TouchableOpacity',{backgroundColor:'#242f3d',padding:'8px 12px',borderRadius:6,alignItems:'center'},{'data-action':'guest-login'},h('Text',{color:'#90caf9',fontSize:12},null,'⚡ 免密游客体验 (一键进入)')),
    )
  );
}

function renderTree(s){
  const char=s.characters.find(c=>c.id===s.activeCharacterId)||null,rel=s.relationship;
  const act=s.schedule?.blocks?.find(b=>b.status==='active')?.activity||rel?.currentActivity||'休息中';
  const sub='📍 '+(rel?.currentLocation||'未知地点')+' · ⏱️ '+act+' · 💭 '+(rel?.currentMoodTag||'平静')+' · ['+(rel?.relationshipStage||'stranger')+'] · 羁绊 '+(rel?.bondScore||0)+' / 1000';
  const [eq,held,car,shared]=['character_equipped','character_held','character_carried','shared_home'].map(sc=>s.inventory.filter(i=>i.scope===sc));

  return h('View',{display:'flex',flexDirection:'row',width:'100%',height:'100%',backgroundColor:'#0e1621'},null,
    !s.currentUser?renderAuthModal(s):null,
    h('View',{width:280,backgroundColor:'#17212b',borderRight:'1px solid #101921',padding:12,gap:10},null,
      h('View',{paddingBottom:10,borderBottom:'1px solid #242f3d',gap:6},null,
        h('Text',{fontSize:18,fontWeight:'bold',color:'#fff'},null,'Character OS v2'),
        s.currentUser?h('View',{backgroundColor:'#101921',padding:8,borderRadius:6,gap:6},null,
          h('Text',{color:'#90caf9',fontSize:12,fontWeight:'600'},null,'👤 '+s.currentUser.displayName+' (@'+s.currentUser.username+')'),
          s.currentUser.telegramUserId?h('Text',{color:'#81c784',fontSize:11},null,'✅ 已绑定 TG: '+s.currentUser.telegramUserId):null,
          s.bindCommand?h('Text',{color:'#ffd54f',fontSize:11},null,'📌 向 TG 机器人发送: '+s.bindCommand):null,
          h('View',{display:'flex',flexDirection:'row',gap:6},null,
            h('TouchableOpacity',{flex:1,backgroundColor:'#242f3d',padding:'4px 8px',borderRadius:4,alignItems:'center'},{'data-action':'bind-telegram'},h('Text',{color:'#fff',fontSize:11},null,'🔗 TG绑定码')),
            h('TouchableOpacity',{backgroundColor:'#3b1d26',padding:'4px 8px',borderRadius:4,alignItems:'center'},{'data-action':'logout'},h('Text',{color:'#ff8a80',fontSize:11},null,'退出')),
          )
        ):null,
        h('TouchableOpacity',{backgroundColor:'#5288c1',padding:'8px 12px',borderRadius:6,alignItems:'center'},{'data-action':'open-studio'},h('Text',{color:'#fff',fontSize:13},null,'+ 新建角色 (角色工坊)')),
        h('TouchableOpacity',{backgroundColor:'#242f3d',padding:'8px 12px',borderRadius:6,alignItems:'center'},{'data-action':'seed-demo'},h('Text',{color:'#fff',fontSize:13},null,'⚡ 一键加载示范角色 (双炽)')),
      ),
      h('ScrollView',{flex:1,gap:4},null,...s.characters.map(c=>h('TouchableOpacity',{padding:10,borderRadius:8,backgroundColor:c.id===s.activeCharacterId?'#242f3d':'transparent',gap:2},{'data-action':'select-character','data-id':c.id},h('Text',{color:'#fff',fontSize:15,fontWeight:'600'},null,c.name),h('Text',{color:'#7e8b99',fontSize:12},null,c.description||c.corePersona||'')))),
    ),
    h('View',{flex:1,backgroundColor:'#0e1621',justifyContent:'space-between'},null,
      h('View',{height:60,backgroundColor:'#17212b',borderBottom:'1px solid #101921',padding:'0 16px',display:'flex',flexDirection:'row',alignItems:'center',justifyContent:'space-between'},null,
        h('View',null,null,h('Text',{color:'#fff',fontSize:16,fontWeight:'bold'},null,char?char.name:'未选择角色'),h('Text',{color:'#7e8b99',fontSize:12,marginTop:2},null,sub)),
        h('TouchableOpacity',{backgroundColor:'#242f3d',padding:'6px 12px',borderRadius:6},{'data-action':'toggle-drawer'},h('Text',{color:'#fff',fontSize:13},null,s.drawerOpen?'收起抽屉 ❯':'展开抽屉 ❮')),
      ),
      h('ScrollView',{flex:1,padding:16,gap:12},{id:'chat-scrollview'},...s.messages.map(m=>h('View',{alignSelf:m.role==='user'?'flex-end':'flex-start',backgroundColor:m.role==='user'?'#2b5278':'#182533',padding:12,borderRadius:12,maxWidth:'75%',gap:6},null,
        m.affectReaction&&h('View',{backgroundColor:'#101921',padding:8,borderRadius:6,borderLeft:'3px solid #5288c1'},null,h('Text',{color:'#64b5f6',fontSize:12},null,'💭 内心OS: '+m.affectReaction.innerMonologue+' | 心情 '+m.affectReaction.moodTag+' (羁绊+'+m.affectReaction.deltaBond+')')),
        h('Text',{color:'#fff',fontSize:14,lineHeight:20},null,m.content),
        m.stickerId&&h('View',{backgroundColor:'#242f3d',padding:'2px 6px',borderRadius:4,alignSelf:'flex-start'},null,h('Text',{color:'#ffd54f',fontSize:11},null,'🏷️ 贴纸: '+m.stickerId)),
        m.mediaUrls?.map(u=>u.endsWith('.mp4')||u.includes('/video')?h('View',{padding:8,backgroundColor:'#101921',borderRadius:6},null,h('Text',{color:'#64b5f6',fontSize:12},null,'🎬 视频: '+u)):h('Image',{width:240,height:160,borderRadius:8},{src:u})),
      ))),
      h('View',{backgroundColor:'#17212b',borderTop:'1px solid #101921',padding:10,gap:8},null,
        inp('chat-input','给TA发消息...',{padding:'10px 12px',borderRadius:8,fontSize:14}),
        h('View',{display:'flex',flexDirection:'row',gap:8},null,
          h('TouchableOpacity',{backgroundColor:'#5288c1',padding:'8px 16px',borderRadius:6},{'data-action':'send-message'},h('Text',{color:'#fff',fontSize:13},null,'发送')),
          h('TouchableOpacity',{backgroundColor:'#242f3d',padding:'8px 12px',borderRadius:6},{'data-action':'quick-selfie'},h('Text',{color:'#fff',fontSize:13},null,'📸 让TA发自拍')),
          h('TouchableOpacity',{backgroundColor:'#242f3d',padding:'8px 12px',borderRadius:6},{'data-action':'quick-video'},h('Text',{color:'#fff',fontSize:13},null,'🎬 让TA发视频')),
        ),
      ),
    ),
    s.drawerOpen?h('ScrollView',{width:360,backgroundColor:'#17212b',borderLeft:'1px solid #101921',padding:16,gap:16},null,
      h('View',{gap:6,paddingBottom:12,borderBottom:'1px solid #242f3d'},null,
        h('Text',{color:'#5288c1',fontSize:14,fontWeight:'bold'},null,'三层情感与深刻印记'),
        ...['羁绊: '+(rel?.bondScore||0)+' / 1000 | 信任: '+(rel?.trustScore||0)+' / 100 | 心境: '+(rel?.moodValence||0),'内心独白: "'+(rel?.innerMonologue||'（暂无独白）')+'"','已解锁阶段: '+(rel?.unlockedStages||['stranger']).join(', '),'深刻印记 ('+s.imprints.length+'): '+(s.imprints.map(i=>'['+i.category+'] '+i.content).join('; ')||'暂无')].map(t=>h('Text',{color:'#e0e0e0',fontSize:12},null,t))),
      h('View',{gap:6,paddingBottom:12,borderBottom:'1px solid #242f3d'},null,
        h('Text',{color:'#5288c1',fontSize:14,fontWeight:'bold'},null,'角色穿戴与随身物品'),
        ...['👔 穿戴: '+(rel?.outfitDesc||eq.map(i=>i.name).join(', ')||'常规便服'),'✋ 手持: '+(held.map(i=>i.name+' x'+i.quantity).join(', ')||'两手空空'),'🎒 随身: '+(car.map(i=>i.name+' x'+i.quantity).join(', ')||'无随身物品')].map(t=>h('Text',{color:'#e0e0e0',fontSize:12},null,t))),
      h('View',{gap:6,paddingBottom:12,borderBottom:'1px solid #242f3d'},null,
        h('Text',{color:'#5288c1',fontSize:14,fontWeight:'bold'},null,'共享空间 / 家里冰箱库存'),
        h('Text',{color:'#e0e0e0',fontSize:12},null,shared.map(i=>'🧊 '+i.name+' x '+i.quantity+' '+(i.unit||'')).join(', ')||'冰箱空空如也'),
        h('View',{display:'flex',flexDirection:'row',gap:6,marginTop:6},null,
          inp('inv-name','物品 (如: 牛奶)',{flex:1,padding:'6px 8px',borderRadius:4,fontSize:12}),
          inp('inv-qty','数量',{width:45,padding:'6px 8px',borderRadius:4,fontSize:12}),
          inp('inv-unit','单位',{width:45,padding:'6px 8px',borderRadius:4,fontSize:12}),
          h('TouchableOpacity',{backgroundColor:'#5288c1',padding:'6px 10px',borderRadius:4},{'data-action':'add-inventory'},h('Text',{color:'#fff',fontSize:12},null,'放入冰箱/共享空间')))),
      h('View',{gap:6},null,
        h('Text',{color:'#5288c1',fontSize:14,fontWeight:'bold'},null,'今日弹性 Schedule 时间轴 (00:00 - 24:00)'),
        ...(s.schedule?.blocks||[]).map(b=>h('View',{padding:6,backgroundColor:'#242f3d',borderRadius:4,gap:2,marginBottom:4},null,
          h('Text',{color:'#64b5f6',fontSize:12,fontWeight:'bold'},null,fmt(b.startMinute)+' - '+fmt(b.endMinute)+' ['+b.status+']'),
          h('Text',{color:'#fff',fontSize:12},null,b.activity+' @ '+b.location)))),
    ):null,
    s.studioModalOpen?h('View',{position:'fixed',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.75)',display:'flex',justifyContent:'center',alignItems:'center',zIndex:100},null,
      h('ScrollView',{width:500,maxHeight:'90%',backgroundColor:'#17212b',borderRadius:12,padding:20,gap:10},null,
        h('View',{display:'flex',flexDirection:'row',justifyContent:'space-between',alignItems:'center'},null,
          h('Text',{color:'#fff',fontSize:18,fontWeight:'bold'},null,'角色工坊 (Character Studio)'),
          h('TouchableOpacity',{padding:4},{'data-action':'close-studio'},h('Text',{color:'#fff',fontSize:18},null,'✕'))),
        ...['char-name:角色姓名 (如: 御狐神双炽)','char-desc:一句话简介 (如: 忠诚温雅、九尾银狐转世)','char-persona:L0 核心灵魂设定 (身份、性格特质、忠诚羁绊)','char-speech:说话语气与口癖范例 (如: "双炽随时听候您的差遣...")','char-home:家/默认常驻地点 (如: 妖馆4号室)','char-outfit:默认穿着 (如: 黑色西服三件套、白衬衫)','char-carried:随身常备物品 (逗号分隔，如: 怀表, 妖馆门卡)'].map(f=>{const[id,ph]=f.split(':');return inp(id,ph);}),
        h('TouchableOpacity',{backgroundColor:'#242f3d',padding:'8px 12px',borderRadius:6,alignItems:'center'},{'data-action':'generate-avatar'},h('Text',{color:'#fff',fontSize:13},null,'🎨 用 VVdance Seedream 生成人设底图')),
        inp('char-avatar-url','人设底图 URL (生图后自动填入)'),
        h('TouchableOpacity',{backgroundColor:'#5288c1',padding:'10px 12px',borderRadius:6,alignItems:'center'},{'data-action':'save-character'},h('Text',{color:'#fff',fontSize:14,fontWeight:'bold'},null,'保存并创建角色')))):null,
  );
}

let activeSse=null;
function render(){
  const root=document.getElementById('rn-root');if(!root)return;
  root.innerHTML='';root.appendChild(renderTree(state));
  const sv=document.getElementById('chat-scrollview');if(sv)sv.scrollTop=sv.scrollHeight;
}

async function loadState(){
  if(!state.currentUser)return render();
  const uid=state.currentUser.id;
  state.characters=await api('/api/characters?userId='+uid);
  if(state.characters.length>0&&!state.activeCharacterId)state.activeCharacterId=state.characters[0].id;
  if(state.activeCharacterId){
    const data=await api('/api/state?userId='+uid+'&characterId='+state.activeCharacterId);
    if(data){
      state.relationship=data.relationship||null;state.schedule=data.schedule||null;
      state.inventory=data.inventory||[];state.imprints=data.imprints||[];
      state.messages=data.messages||[];state.mediaTasks=data.mediaTasks||[];
    }
  }
  render();
}

function connectSse(userId){
  if(activeSse){try{activeSse.close();}catch(e){}}
  const es=new EventSource('/api/events?userId='+userId);
  activeSse=es;
  es.onmessage=(e)=>{
    try{
      const {type,payload}=JSON.parse(e.data);
      if(type==='message.created'){state.messages.push(payload);render();}
      else if(type==='relationship.updated'){state.relationship=payload;render();}
      else if(type==='inventory.updated'){
        const idx=state.inventory.findIndex(i=>i.id===payload.id);
        if(idx>=0)state.inventory[idx]=payload;else state.inventory.push(payload);
        render();
      }else if(type==='schedule.updated'){state.schedule=payload;render();}
      else if(type==='media.updated'){
        const idx=state.mediaTasks.findIndex(t=>t.id===payload.id);
        if(idx>=0)state.mediaTasks[idx]=payload;else state.mediaTasks.push(payload);
        render();
      }
    }catch(err){}
  };
}

function applyAuthenticatedUser(user,token){
  if(token)localStorage.setItem('cos_auth_token',token);
  localStorage.setItem('cos_user_id',user.id);
  state.currentUser=user;state.authError='';state.bindCommand='';
  connectSse(user.id);
  loadState();
}

setInterval(async()=>{
  for(const t of state.mediaTasks.filter(m=>m.status==='pending'||m.status==='running')){
    try{
      const res=await api('/api/media/poll/'+encodeURIComponent(t.id),{method:'POST'});
      if(res&&res.id){const idx=state.mediaTasks.findIndex(m=>m.id===res.id);if(idx>=0)state.mediaTasks[idx]=res;render();}
    }catch(e){}
  }
},3000);

document.addEventListener('click',async(e)=>{
  const target=e.target.closest('[data-action]');if(!target)return;
  const action=target.getAttribute('data-action'),uid=state.currentUser?.id,cid=state.activeCharacterId;
  if(action==='switch-auth-login'){state.authMode='login';state.authError='';render();}
  else if(action==='switch-auth-register'){state.authMode='register';state.authError='';render();}
  else if(action==='submit-login'||action==='submit-register'){
    const username=document.getElementById('auth-username')?.value.trim()||'';
    const password=document.getElementById('auth-password')?.value||'';
    const displayName=document.getElementById('auth-displayname')?.value.trim()||'主人';
    const ep=action==='submit-register'?'/api/auth/register':'/api/auth/login';
    const res=await api(ep,{method:'POST',body:JSON.stringify({username,password,displayName})});
    if(!res||!res.ok){state.authError=res?.error||'认证失败';render();return;}
    applyAuthenticatedUser(res.user,res.token);
  }else if(action==='guest-login'){
    const u=await api('/api/users',{method:'POST',body:JSON.stringify({username:'guest_'+Date.now().toString(36),displayName:'主人'})});
    if(u&&u.id)applyAuthenticatedUser(u,'');
  }else if(action==='logout'){
    await api('/api/auth/logout',{method:'POST'});
    localStorage.removeItem('cos_auth_token');localStorage.removeItem('cos_user_id');
    if(activeSse){try{activeSse.close();}catch(err){}activeSse=null;}
    state.currentUser=null;state.characters=[];state.activeCharacterId=null;state.messages=[];state.bindCommand='';render();
  }else if(action==='bind-telegram'){
    if(!uid)return;
    const res=await api('/api/auth/telegram-bind-code',{method:'POST',body:JSON.stringify({userId:uid})});
    if(res&&res.command){state.bindCommand=res.command;render();}
  }else if(action==='seed-demo'){await api('/api/seed-demo',{method:'POST',body:JSON.stringify({userId:uid})});await loadState();}
  else if(action==='select-character'){state.activeCharacterId=target.getAttribute('data-id');await loadState();}
  else if(action==='open-studio'){state.studioModalOpen=true;render();}
  else if(action==='close-studio'){state.studioModalOpen=false;render();}
  else if(action==='toggle-drawer'){state.drawerOpen=!state.drawerOpen;render();}
  else if(action==='send-message'||action==='quick-selfie'||action==='quick-video'){
    const isQ=action!=='send-message';
    const text=isQ?(action==='quick-selfie'?'📸 让TA发自拍':'🎬 让TA发视频'):(document.getElementById('chat-input')?.value.trim()||'');
    if(!text||!uid||!cid)return;
    if(!isQ)document.getElementById('chat-input').value='';
    await api('/api/chat',{method:'POST',body:JSON.stringify({userId:uid,characterId:cid,text})});
    await loadState();
  }else if(action==='add-inventory'){
    const name=document.getElementById('inv-name')?.value.trim(),qty=parseFloat(document.getElementById('inv-qty')?.value||'1'),unit=document.getElementById('inv-unit')?.value.trim()||'件';
    if(!name||!uid||!cid)return;
    await api('/api/inventory',{method:'POST',body:JSON.stringify({userId:uid,characterId:cid,scope:'shared_home',locationTag:'冰箱',name,quantity:qty,unit,description:'生活物资'})});
    await loadState();
  }else if(action==='generate-avatar'){
    const name=document.getElementById('char-name')?.value.trim()||'新角色',persona=document.getElementById('char-persona')?.value.trim()||'';
    target.disabled=true;
    try{
      const res=await api('/api/studio/generate-avatar',{method:'POST',body:JSON.stringify({prompt:'Portrait of '+name+', '+persona,includeSelf:true})});
      if(res&&res.url){const inpEl=document.getElementById('char-avatar-url');if(inpEl)inpEl.value=res.url;}
    }finally{target.disabled=false;}
  }else if(action==='save-character'){
    const name=document.getElementById('char-name')?.value.trim();if(!name)return alert('请输入角色姓名');
    const description=document.getElementById('char-desc')?.value.trim()||'',corePersona=document.getElementById('char-persona')?.value.trim()||'';
    const speechStyle=document.getElementById('char-speech')?.value.trim()||'',homeLocation=document.getElementById('char-home')?.value.trim()||'家';
    const defaultOutfit=document.getElementById('char-outfit')?.value.trim()||'常服',carriedRaw=document.getElementById('char-carried')?.value.trim()||'';
    const avatarUrl=document.getElementById('char-avatar-url')?.value.trim()||'';
    const defaultCarriedItems=carriedRaw?carriedRaw.split(/[,，]/).map(s=>s.trim()).filter(Boolean):[];
    const created=await api('/api/characters',{method:'POST',body:JSON.stringify({creatorUserId:uid,name,description,corePersona,speechStyle,avatarUrl,referenceImageDataUrl:avatarUrl,lifestyleProfile:{homeLocation,defaultEnvironment:'室内',usualPlaces:[homeLocation],dailyBaseline:'日常生活',defaultOutfit,defaultCarriedItems}})});
    state.studioModalOpen=false;if(created&&created.id)state.activeCharacterId=created.id;await loadState();
  }
});

document.addEventListener('keydown',(e)=>{
  if(e.target&&e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    const btn=document.querySelector('[data-action="send-message"]');if(btn)btn.click();
  }
});

(async()=>{
  const tk=getToken();
  if(tk){
    const me=await api('/api/auth/me');
    if(me&&me.ok&&me.user){applyAuthenticatedUser(me.user,tk);return;}
    localStorage.removeItem('cos_auth_token');
  }
  render();
})();
`;
}
