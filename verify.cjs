const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const origin='https://popangetivmijcqnwohl.supabase.co';
const state={users:{},bars:{},profiles:{},sessions:[],orders:[],tokens:{}};
const session=u=>{const access_token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:u.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test'].join('.');state.tokens[access_token]=u;return{access_token,refresh_token:u.id,expires_in:3600,token_type:'bearer',user:u};};
let failNext=false;
async function backend(route){
 const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method();let body={};try{body=req.postDataJSON()||{};}catch{}
 const user=state.tokens[(req.headers().authorization||'').replace('Bearer ','')];
 const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 const eq=name=>(url.searchParams.get(name)||'').replace(/^eq\./,'');
 if(method==='OPTIONS')return send({});
 if(p.endsWith('/signup')){const u={id:crypto.randomUUID(),email:body.email,user_metadata:body.data||{}};state.users[u.email]={...u,password:body.password};state.bars[u.id]={user_id:u.id,stock:[],favorites:[],custom_recipes:[]};state.profiles[u.id]={user_id:u.id,display_name:body.data.display_name};return send({user:u,session:null});}
 if(p.endsWith('/token')){const r=url.searchParams.get('grant_type')==='refresh_token'?Object.values(state.users).find(u=>u.id===body.refresh_token):state.users[body.email];if(!r||(body.password&&r.password!==body.password))return send({message:'Invalid login credentials'},400);const{password,...u}=r;return send(session(u));}
 if(p.endsWith('/user'))return send(user||{},user?200:401);
 if(p.endsWith('/logout')||p.endsWith('/recover'))return send({});
 if(p.endsWith('/rpc/tipsy_public_menu')){const s=state.sessions.find(s=>s.share_code===body.p_share_code&&s.is_open);return send(s?[{session_id:s.id,bar_name:s.bar_name,menu:s.menu,published_recipes:s.published_recipes}]:[]);}
 if(p.endsWith('/rpc/tipsy_place_order')){const s=state.sessions.find(s=>s.share_code===body.p_share_code&&s.is_open&&s.menu.includes(body.p_recipe_id));if(!s)return send({message:'今晚菜单已关闭或该饮品不在菜单中'},400);const o={id:crypto.randomUUID(),session_id:s.id,guest_name:body.p_guest_name,recipe_id:body.p_recipe_id,sweetness:body.p_sweetness,status:'pending',created_at:new Date().toISOString()};state.orders.push(o);return send(o.id);}
 if(!user)return send({message:'permission denied'},403);
 if(p.endsWith('/tipsy_profiles'))return send(state.profiles[user.id]);
 if(p.endsWith('/tipsy_bar_data')){if(method==='PATCH'){if(failNext){failNext=false;return send({message:'Failed to fetch'},503);}assert.equal(eq('user_id'),user.id);Object.assign(state.bars[user.id],body);}return send(state.bars[user.id]);}
 if(p.endsWith('/tipsy_sessions')){if(method==='POST'){const s={...body,id:crypto.randomUUID(),share_code:crypto.randomUUID(),is_open:true,created_at:new Date().toISOString()};state.sessions.push(s);return send(s);}if(method==='PATCH'){const s=state.sessions.find(s=>s.id===eq('id')&&s.owner_id===user.id);Object.assign(s,body);return send(s);}return send(state.sessions.filter(s=>s.owner_id===user.id).slice(-1));}
 if(p.endsWith('/tipsy_orders')){const ids=state.sessions.filter(s=>s.owner_id===user.id).map(s=>s.id);if(method==='PATCH'){const o=state.orders.find(o=>o.id===eq('id')&&ids.includes(o.session_id));o.status=body.status;return send(o);}return send(state.orders.filter(o=>o.session_id===eq('session_id')&&ids.includes(o.session_id)));}
 return send({message:'Unknown mock endpoint'},500);
}
(async()=>{
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.join(__dirname,pathname==='/'?'index.html':decodeURIComponent(pathname));try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/`;let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});const errors=[];
  const create=async()=>{const ctx=await browser.newContext({viewport:{width:1440,height:1100}});await ctx.route(origin+'/**',backend);const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return page;};
  const a=await create();await a.addInitScript(()=>localStorage.setItem('tipsy-v1',JSON.stringify({current:'old@test',accounts:{'old@test':{stock:['旧酒柜'],favs:['gt'],custom:[{name:'旧配方'}]}}})));await a.goto(base);await a.locator('.cocktail-card').first().waitFor();
  const register=async(p,email,name)=>{await p.click('#account-button');await p.click('[data-auth-mode="register"]');await p.fill('[name="nickname"]',name);await p.fill('[name="email"]',email);await p.fill('[name="password"]','demo123456');await p.click('#auth-form button[type="submit"]');await p.locator('#toast').filter({hasText:'查看邮箱'}).waitFor();};
  const login=async(p,email)=>{await p.click('#account-button');await p.fill('[name="email"]',email);await p.fill('[name="password"]','demo123456');await p.click('#auth-form button[type="submit"]');await p.locator('#account-label').filter({hasText:'云端已连接'}).waitFor();};
  await register(a,'a@example.test','小调');await a.click('#account-button');await a.fill('[name="email"]','a@example.test');await a.fill('[name="password"]','wrong-password');await a.click('#auth-form button[type="submit"]');await a.locator('#auth-error').filter({hasText:'不正确'}).waitFor();await a.click('#close-modal');await login(a,'a@example.test');await a.click('[data-page="mine"]');await a.locator('.empty').waitFor();assert.deepEqual(state.bars[Object.values(state.users)[0].id].stock,[]);
  await a.click('#edit-stock');for(const ingredient of ['金酒','汤力水'])await a.locator(`input[value="${ingredient}"]`).check();await a.click('#stock-form button[type="submit"]');await a.locator('#toast').filter({hasText:'已保存到云端'}).waitFor();
  await a.click('[data-page="mix"]');await a.click('[data-fav="gt"]');await a.locator('[data-fav="gt"].selected').waitFor();
  await a.click('[data-page="mine"]');await a.click('#new-recipe');await a.fill('[name="name"]','云端晚风');await a.fill('[name="parts"]','金酒 30 ml\n汤力水 90 ml');await a.fill('[name="steps"]','加冰。\n倒入材料。');await a.click('#recipe-form button[type="submit"]');await a.getByRole('button',{name:'查看云端晚风配方'}).waitFor();
  const b=await create();await b.goto(base);await login(b,'a@example.test');await b.click('[data-page="mine"]');await b.getByRole('button',{name:'查看云端晚风配方'}).waitFor();await b.getByRole('button',{name:'查看金汤力配方'}).waitFor();
  failNext=true;await a.click('#edit-stock');await a.locator('input[value="白朗姆"]').check();await a.click('#stock-form button[type="submit"]');await a.locator('#toast').filter({hasText:'网络连接失败'}).waitFor();assert(!state.bars[Object.values(state.users)[0].id].stock.includes('白朗姆'));await a.click('#close-modal');
  await a.click('#party-link');await a.locator('input[name="menu"][value="gt"]').check();await a.click('#menu-form button[type="submit"]');await a.locator('#share-url').waitFor();const share=await a.locator('#share-url').inputValue();
  const g=await create();await g.goto(share);await g.fill('#guest-name','小林');await g.click('[data-order="gt"]');await g.click('#order-form button[type="submit"]');await g.locator('#toast').filter({hasText:'已下单'}).waitFor();await a.click('#refresh-orders');await a.locator('[data-status]').click();await a.locator('[data-status]').click();await a.getByText('已完成',{exact:true}).waitFor();
  await a.click('#close-party');await a.locator('#toast').filter({hasText:'结束营业'}).waitFor();await g.reload();await g.getByText('今晚菜单已关闭',{exact:true}).waitFor();
  await b.click('#account-button');await b.click('#logout');await register(b,'b@example.test','另一个人');await login(b,'b@example.test');await b.click('[data-page="mine"]');assert.equal(await b.locator('.cocktail-card').count(),0);
  await a.setViewportSize({width:390,height:844});await a.click('[data-page="mine"]');await a.screenshot({path:'preview-mobile.png',fullPage:true});assert(!(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
  await a.setViewportSize({width:1440,height:1100});await a.click('[data-page="classics"]');await a.screenshot({path:'preview-desktop.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('PASS browser (real SDK, mock HTTP): confirmed-email workflow, cloud writes, no local import, cross-device read, save failure, guest orders, owner queue, closed menu, account isolation, mobile layout.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});
