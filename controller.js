const cloud = window.TipsyCloud;
let accountLoading = false, saving = false, authEpoch = 0, activeParty = null;
let guestCode = new URL(location.href).searchParams.get('party');
let guestMenu = null, guestLoading = false, guestError = '', refreshing = false;
let sessionPromise = null, sessionKey = null;

function requireAccount() {
  if (accountLoading) { toast('正在读取账号资料，请稍等'); return false; }
  if (!state.current || !state.account) { auth(); return false; }
  if (saving) { toast('正在保存，请稍等'); return false; }
  return true;
}
function updateAccount() {
  $('#account-label').innerHTML = accountLoading ? '正在同步…<small>连接你的云端酒单</small>' : state.current && state.account
    ? `${esc(profile().name)}<small>我的账号 · 云端已连接</small>` : '登录 / 注册<small>让酒单跟随你的账号</small>';
}
function errorMessage(error) { return cloud.message(error); }
async function action(task, errorTarget) {
  if (saving) return;
  saving = true;
  const controls = $$('button[type="submit"], #logout, #close-party, [data-status], .fav');
  controls.forEach(b => b.disabled = true);
  try { await task(); }
  catch (error) { const target = errorTarget && $(errorTarget); if (target) target.textContent = errorMessage(error); else toast(errorMessage(error)); }
  finally { saving = false; controls.forEach(b => b.disabled = false); }
}
function auth(mode = 'login') {
  authMode = mode;
  if (!cloud.configured) {
    showModal(`<div class="modal-inner"><div class="eyebrow">MY CLOUD ACCOUNT</div><h2>账号服务正在准备</h2><p class="sub">你仍可以浏览经典酒谱。账号登录与云端保存将在服务连接完成后开放。</p><div class="notice">${esc(cloud.configurationError || 'Supabase 项目尚未配置。')}</div></div>`);
    return;
  }
  const register = mode === 'register', reset = mode === 'reset', recovery = mode === 'recovery';
  showModal(`<div class="modal-inner"><div class="auth-brand"><span class="brand-symbol">t.</span><h2>${recovery?'设置新密码':reset?'找回密码':register?'开一间自己的小酒吧':'欢迎回到微调'}</h2><p>你的酒柜与酒单，随账号一起保存。</p></div>${reset||recovery?'':`<div class="auth-tabs"><button class="${!register?'active':''}" data-auth-mode="login">登录</button><button class="${register?'active':''}" data-auth-mode="register">注册账号</button></div>`}<form id="auth-form">${register?'<label class="form-field"><span>你的昵称</span><input name="nickname" maxlength="20" autocomplete="nickname" required placeholder="朋友们怎么称呼你？"></label>':''}${recovery?'':'<label class="form-field"><span>邮箱</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>'}${reset?'':`<label class="form-field"><span>${recovery?'新密码':'密码'}</span><input name="password" type="password" minlength="8" maxlength="128" autocomplete="${register||recovery?'new-password':'current-password'}" required placeholder="至少 8 位"></label>`}<div class="form-error" id="auth-error" role="alert"></div><button class="primary full" type="submit">${recovery?'保存新密码':reset?'发送重置邮件':register?'创建账号':'登录'} ↗</button></form>${reset||recovery?'<button class="auth-guest" data-auth-mode="login">返回登录</button>':'<button class="auth-guest" data-auth-mode="reset">忘记密码？</button>'}<p class="sub" style="font-size:11px;margin-top:20px;color:var(--muted)">${register?'注册后请查看邮箱并完成验证。新账号从空酒柜开始。':'通过 Supabase 安全登录；密码由认证服务处理。'}</p></div>`);
}
function accountModal() {
  if (accountLoading) { toast('正在读取账号，请稍等'); return; }
  if (!state.current || !state.account) { auth(); return; }
  showModal(`<div class="modal-inner"><div class="eyebrow">MY ACCOUNT</div><h2>你好，${esc(profile().name)}。</h2><p class="sub">${esc(state.current.email)}</p><div class="stats"><div class="stat"><strong>${profile().stock.length}</strong><p>酒柜配料</p></div><div class="stat"><strong>${profile().favs.length}</strong><p>收藏配方</p></div><div class="stat"><strong>${profile().custom.length}</strong><p>个人配方</p></div></div><div class="notice">资料保存在云端。使用同一账号在其他设备登录，即可读取这份酒柜与酒单。</div><div class="modal-actions"><button class="secondary" id="logout">退出登录</button><button class="primary" id="account-mine">查看我的酒单 ↗</button></div></div>`);
}
function applySession(session, force = false) {
  const key = session?.user?.id || null;
  if (sessionPromise && key === sessionKey) return sessionPromise;
  sessionKey = key;
  const promise = syncSession(session, force);
  sessionPromise = promise;
  const clear = () => { if (sessionPromise === promise) sessionPromise = null; };
  promise.then(clear, clear);
  return promise;
}
async function syncSession(session, force = false) {
  const user = session?.user || null;
  if (!force && user?.id && user.id === state.current?.id && state.account) { state.current = user; updateAccount(); return; }
  const epoch = ++authEpoch;
  if (state.current?.id !== user?.id && $('#modal').open && !$('#auth-form')) closeModal();
  state.current = user; state.account = null; activeParty = null;
  accountLoading = !!user;
  if (user) {
    updateAccount();
    try {
      const [personal, party] = await Promise.all([cloud.load(user), cloud.party(user.id)]);
      if (epoch !== authEpoch) return;
      state.account = personal;
      activeParty = party;
      if (party) await refreshOrders(epoch);
    } catch (error) {
      if (epoch === authEpoch) toast(errorMessage(error));
    }
  }
  if (epoch !== authEpoch) return;
  accountLoading = false;
  render();
}
async function refreshOrders(epoch = authEpoch) {
  if (!activeParty || !state.account) return;
  const party = activeParty;
  const data = await cloud.orders(party.id);
  if (epoch !== authEpoch || activeParty?.id !== party.id || !state.account) return;
  state.account.menu = party.menu;
  state.account.open = party.is_open;
  state.account.orders = data.map(o => ({ id: o.id, recipe: o.recipe_id, name: recipe(o.recipe_id)?.name || o.recipe_id,
    guest: o.guest_name, sweet: o.sweetness, status: o.status,
    time: new Date(o.created_at).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) }));
}
async function toggleFav(id) {
  if (!requireAccount()) return;
  const userId = state.current.id, epoch = authEpoch;
  const old = profile().favs, existed = old.includes(id);
  const next = existed ? old.filter(v => v !== id) : [...old, id];
  await action(async () => {
    await cloud.patch(userId, { favorites: next });
    if (epoch !== authEpoch) return;
    profile().favs = next; render();
    if ($('#modal').open && $('#modal-content [data-make]')) detail(id);
    toast(existed?'已移出收藏':'已保存到云端酒单');
  });
}
function shareUrl() {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  if (activeParty) url.searchParams.set('party', activeParty.share_code);
  return url.href;
}
function renderParty() {
  if (!state.current || !state.account) {
    $('#main').innerHTML = '<div class="empty"><strong>登录后开启你的家庭酒吧</strong><p>菜单和订单会跟随账号，在其他设备也能查看。</p><button class="primary" data-auth>登录 / 注册 ↗</button></div>'; return;
  }
  const p=profile(), available=readyRecipes();
  $('#main').innerHTML=`<div class="page-intro"><div class="eyebrow">FRIENDS, DRINKS & GOOD TIMES</div><h1>今晚，我家是酒吧。</h1><p>分享一张菜单，让朋友选自己喜欢的味道。</p></div><div class="section-heading"><button class="text-link" data-go="mine">← 返回我的酒单</button><span class="text-link">${p.open?'● 正在营业':'○ 尚未营业'}</span></div><div class="party-layout"><section class="panel"><h2>今晚供应</h2><p class="sub">勾选当前能做的酒，发布今晚菜单。</p><form id="menu-form">${available.length?available.map(r=>`<label class="menu-select"><input type="checkbox" name="menu" value="${r.id}" ${p.menu.includes(r.id)?'checked':''}>${esc(r.name)}<small>${esc(r.strength)}</small></label>`).join(''):'<div class="notice">酒柜里还没有能做的酒。<button class="reduced-link" id="edit-stock">添加家中配料 ↗</button></div>'}<div class="modal-actions"><button class="primary" type="submit">${p.open?'更新今晚菜单':'开启今晚营业'} ↗</button></div></form>${p.open?`<div class="modal-actions"><button class="secondary" id="copy-menu">复制点单链接 ↗</button><button class="secondary" id="preview-menu">查看朋友菜单</button></div><label class="form-field" style="margin-top:18px"><span>分享给朋友，免登录点单</span><input readonly id="share-url" value="${esc(shareUrl())}" aria-label="点单分享链接"></label><button class="text-link" id="close-party">结束营业</button>`:''}</section><section class="panel"><h2>制作队列 <span style="color:var(--orange)">${p.orders.filter(o=>o.status!=='done').length}</span></h2><p class="sub">页面打开时每 8 秒更新一次订单。<button class="reduced-link" id="refresh-orders">立即刷新</button></p>${p.orders.length?p.orders.slice().reverse().map(o=>`<div class="order-row"><span class="avatar">${esc(o.guest.slice(0,1))}</span><div><h4>${esc(o.name)} <span class="order-status">${({pending:'待制作',making:'制作中',done:'已完成'})[o.status]}</span></h4><p>${esc(o.guest)} · ${esc(o.sweet)} · ${o.time}</p></div>${o.status!=='done'?`<button class="secondary" data-status="${o.id}">${o.status==='pending'?'开始制作':'完成 ✓'}</button>`:''}</div>`).join(''):'<div class="empty"><strong>等待第一杯订单</strong>把分享链接发给朋友，他们就能从自己的手机点单。</div>'}</section></div>`;
}
function guestName() { try { return sessionStorage.getItem('tipsy-guest-name') || ''; } catch { return ''; } }
function renderGuest() {
  const list = guestMenu ? guestMenu.menu.map(recipe).filter(Boolean) : [];
  $('#main').innerHTML=`<div class="section-heading">${state.current?'<button class="text-link" data-go="party">← 返回主人工作台</button>':'<button class="text-link" data-go="classics">浏览经典酒谱 ↗</button>'}<span class="text-link">免登录 · 朋友点单</span></div><div class="guest-header"><div class="eyebrow" style="justify-content:center">WELCOME TO OUR HOME BAR</div><h1>${esc(guestMenu?.bar_name || '今晚的家庭酒吧')}<span style="color:var(--orange)">。</span></h1><p>选一杯喜欢的，剩下的交给主人。</p></div>${guestMenu?`<label class="form-field guest-name"><span>你的昵称</span><input id="guest-name" maxlength="40" placeholder="例如：小林" value="${esc(guestName())}"></label>`:''}<div class="cards">${guestMenu?cards(list,true):`<div class="empty"><strong>${guestLoading?'正在打开今晚菜单…':guestError?'暂时无法读取菜单':'今晚菜单已关闭'}</strong>${esc(guestError || (guestLoading?'请稍等':'联系主人获取新的点单链接。'))}${guestError?'<p><button class="secondary" id="retry-menu">重试</button></p>':''}</div>`}</div>`;
}
async function loadGuestMenu() {
  const code = guestCode;
  guestLoading = true; guestError = ''; guestMenu = null; renderGuest();
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code || '')) throw Error('点单链接无效，请向主人索取完整链接');
    const data = await cloud.publicMenu(code);
    if (code === guestCode) guestMenu = data;
  } catch (error) { if (code === guestCode) guestError = errorMessage(error); }
  finally { guestLoading = false; if (page === 'guest') renderGuest(); }
}
function orderModal(id) {
  const name = $('#guest-name')?.value.trim();
  if (!name) { toast('先留下昵称，让主人知道这杯给谁'); $('#guest-name')?.focus(); return; }
  try { sessionStorage.setItem('tipsy-guest-name', name); } catch {}
  const r = recipe(id); if (!r) return;
  showModal(`<div class="modal-inner"><div class="eyebrow">ONE GOOD DRINK, PLEASE</div><h2>${esc(r.name)}</h2><p class="sub">${esc(name)}，你想要什么口味？</p><form id="order-form" data-recipe="${esc(id)}" data-guest="${esc(name)}"><label class="form-field"><span>口味偏好</span><select name="sweet"><option>标准口味</option><option>少甜一点</option><option>酸一点</option><option>酒感轻一点</option></select></label><div class="form-error" id="order-error" role="alert"></div><button class="primary full" type="submit">确认点单 ＋</button></form></div>`);
}

document.addEventListener('click', async e => {
  const b=e.target.closest('button,[data-detail],[data-go]'); if(!b || b.disabled) return;
  if(b.dataset.page){navigate(b.dataset.page);return;} if(b.dataset.go){navigate(b.dataset.go);return;}
  if(b.dataset.detail){detail(b.dataset.detail);return;} if(b.dataset.fav){await toggleFav(b.dataset.fav);return;} if(b.dataset.make){startMaking(b.dataset.make);return;}
  if(b.dataset.filter){filter=b.dataset.filter;renderMix();return;} if(b.dataset.mineFilter){mineFilter=b.dataset.mineFilter;renderMine();return;} if(b.dataset.classicFilter){classicFilter=b.dataset.classicFilter;renderClassics();return;}
  if(b.hasAttribute('data-auth')){auth();return;} if(b.dataset.authMode){auth(b.dataset.authMode);return;} if(b.dataset.order){orderModal(b.dataset.order);return;}
  if(b.dataset.status){if(!requireAccount())return;const o=profile().orders.find(o=>o.id===b.dataset.status);if(o)await action(async()=>{await cloud.updateOrder(o.id,o.status==='pending'?'making':'done');await refreshOrders();renderParty();});return;}
  switch(b.id){
    case 'account-button':case 'mobile-account':accountModal();break;
    case 'close-modal':closeModal();break;
    case 'edit-stock':stockModal();break;
    case 'new-recipe':createModal();break;
    case 'party-link':navigate('party');break;
    case 'pick-drink':{const list=readyRecipes();if(list.length)detail(list[Math.floor(Math.random()*list.length)].id);else stockModal();break;}
    case 'prev-step':startMaking(making,step-1);break;
    case 'next-step':if(step<recipe(making).steps.length-1)startMaking(making,step+1);else{closeModal();toast('这一杯完成了，慢慢享用！');}break;
    case 'logout':await action(async()=>{await cloud.signOut();closeModal();await applySession(null);toast('已退出登录');});break;
    case 'account-mine':closeModal();navigate('mine');break;
    case 'close-party':if(requireAccount()&&activeParty)await action(async()=>{activeParty=await cloud.close(state.current.id,activeParty.id);profile().open=false;renderParty();toast('已结束营业，订单仍保存在账号中');});break;
    case 'refresh-orders':await action(async()=>{await refreshOrders();renderParty();});break;
    case 'preview-menu':guestCode=activeParty.share_code;navigate('guest');await loadGuestMenu();break;
    case 'retry-menu':await loadGuestMenu();break;
    case 'copy-menu':try{await navigator.clipboard.writeText(shareUrl());toast('点单链接已复制');}catch{$('#share-url')?.select();toast('请复制上方的点单链接');}break;
  }
});
document.addEventListener('keydown',e=>{if(e.target.matches('[data-detail]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();detail(e.target.dataset.detail);}});
document.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;updateCards();}});
document.addEventListener('submit', async e => {
  e.preventDefault(); const f=e.target, data=new FormData(f);
  if(f.id==='auth-form'){
    const mode=authMode,email=String(data.get('email')||'').trim().toLowerCase(),password=String(data.get('password')||'');
    await action(async()=>{
      if(mode==='reset'){await cloud.resetPassword(email);closeModal();toast('若邮箱可用，你会收到重置密码邮件');return;}
      if(mode==='recovery'){await cloud.updatePassword(password);closeModal();toast('新密码已保存');return;}
      const response=mode==='register'?await cloud.signUp(email,password,String(data.get('nickname')||'').trim()):await cloud.signIn(email,password);
      if(response.session){await applySession(response.session);if(!state.account)throw Error('登录成功，但资料读取失败，请检查数据库配置后重新登录');closeModal();toast(`欢迎，${profile().name}`);}
      else{closeModal();toast('请查看邮箱，完成验证后再登录');}
    },'#auth-error');return;
  }
  if(f.id==='order-form'){
    await action(async()=>{await cloud.placeOrder(guestCode,f.dataset.guest,f.dataset.recipe,String(data.get('sweet')));closeModal();toast('已下单！主人会在制作队列看到你的这一杯。');},'#order-error');return;
  }
  if(!requireAccount())return;
  const userId=state.current.id,epoch=authEpoch;
  if(f.id==='stock-form')await action(async()=>{const next=data.getAll('stock');await cloud.patch(userId,{stock:next});if(epoch!==authEpoch)return;profile().stock=next;closeModal();render();toast(`已保存到云端，现在可以做 ${readyRecipes().length} 款酒`);});
  if(f.id==='recipe-form'){
    const parts=String(data.get('parts')).trim().split('\n').filter(s=>s.trim()).map(s=>{const match=s.trim().match(/^(\S+)\s+(.+)$/);return match?[match[1],match[2]]:null;});
    if(!parts.length||parts.some(p=>!p)){$('#recipe-error').textContent='每行请填写“配料名称 用量”，例如：金酒 45 ml。';return;}
    const steps=String(data.get('steps')).trim().split('\n').map(s=>s.trim()).filter(Boolean),name=String(data.get('name')).trim();
    if(!name||!steps.length){$('#recipe-error').textContent='请填写酒名与至少一个步骤';return;}
    const r={id:`custom-${crypto.randomUUID()}`,name,en:'My Signature Drink',type:'coupe',color:'#eadcc6',liquid:'#dfab5a',flavors:['自创配方','我的口味'],strength:data.get('strength'),time:Number(data.get('time')),parts,steps,story:String(data.get('note')).trim(),custom:true};
    const next=[...profile().custom,r];await action(async()=>{await cloud.patch(userId,{custom_recipes:next});if(epoch!==authEpoch)return;profile().custom=next;closeModal();mineFilter='custom';navigate('mine');toast('你的配方已保存到云端酒单');},'#recipe-error');
  }
  if(f.id==='menu-form'){
    const menu=data.getAll('menu');if(!menu.length){toast('至少选择一款今晚供应的饮品');return;}
    const published=profile().custom.filter(r=>menu.includes(r.id));
    await action(async()=>{const party=await cloud.publish(userId,`${profile().name}的小酒吧`,menu,published,activeParty);if(epoch!==authEpoch)return;activeParty=party;await refreshOrders();renderParty();toast('今晚菜单已发布，可以分享给朋友了');});
  }
});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
$('.brand').addEventListener('click',e=>{e.preventDefault();navigate('mix');});
async function poll() {
  if (document.hidden || refreshing || saving || accountLoading) return;
  refreshing=true;
  try {
    if(page==='party'&&state.account){const epoch=authEpoch,party=await cloud.party(state.current.id);if(epoch!==authEpoch)return;activeParty=party;if(party)await refreshOrders(epoch);if(!$('#modal').open&&!document.activeElement?.matches('input'))renderParty();}
  } catch {} finally {refreshing=false;}
}
setInterval(poll,8000);
window.addEventListener('focus',async()=>{
  if(!cloud.configured||saving||accountLoading||$('#modal').open)return;
  try{await applySession(await cloud.session(),true);}catch(error){toast(errorMessage(error));}
});
render();
if(guestCode){page='guest';render();loadGuestMenu();}
if(cloud.configured){
  cloud.listen((event,session)=>{
    if(event==='PASSWORD_RECOVERY')auth('recovery');
    applySession(session).catch(error=>toast(errorMessage(error)));
  });
  cloud.session().then(session=>applySession(session)).catch(error=>toast(errorMessage(error)));
}
