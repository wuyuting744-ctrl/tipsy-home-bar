const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
  const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
  await db.query('insert into auth.users(id) values ($1),($2)',[a,b]);
  const run = async (role,user,sql,params=[]) => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user || '']);
    try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
  };
  let rows=(await run('authenticated',a,'select * from public.tipsy_bar_data')).rows;
  assert.equal(rows.length,1);assert.deepEqual(rows[0].stock,[]);assert.deepEqual(rows[0].custom_recipes,[]);
  await run('authenticated',a,"update public.tipsy_bar_data set stock=array['金酒','汤力水'] where user_id=$1",[a]);
  assert.deepEqual((await run('authenticated',b,'select * from public.tipsy_bar_data')).rows[0].stock,[]);
  assert.equal((await run('authenticated',b,'update public.tipsy_bar_data set stock=$1 where user_id=$2 returning *',[[],a])).rows.length,0);
  await assert.rejects(run('authenticated',a,'insert into public.tipsy_profiles(user_id) values($1)',[b]),/row-level security/);
  const session=(await run('authenticated',a,"insert into public.tipsy_sessions(owner_id,menu,bar_name) values($1,array['gt'],'测试酒吧') returning *",[a])).rows[0];
  assert.equal((await run('authenticated',b,'select * from public.tipsy_sessions')).rows.length,0);
  await assert.rejects(run('anon',null,'select * from public.tipsy_bar_data'),/permission denied/);
  await assert.rejects(run('anon',null,'select * from public.tipsy_orders'),/permission denied/);
  const menu=(await run('anon',null,'select * from public.tipsy_public_menu($1)',[session.share_code])).rows;
  assert.equal(menu.length,1);assert.equal(menu[0].bar_name,'测试酒吧');
  assert.equal((await run('anon',null,'select * from public.tipsy_public_menu($1)',[a])).rows.length,0);
  await assert.rejects(run('anon',null,'select public.tipsy_place_order($1,$2,$3,$4)',[session.share_code,'小林','negroni','标准口味']),/不在菜单/);
  const order=(await run('anon',null,'select public.tipsy_place_order($1,$2,$3,$4) as id',[session.share_code,'小林','gt','标准口味'])).rows[0].id;
  assert.equal((await run('authenticated',b,'select * from public.tipsy_orders')).rows.length,0);
  assert.equal((await run('authenticated',a,'select * from public.tipsy_orders')).rows.length,1);
  await assert.rejects(run('anon',null,'select public.tipsy_place_order($1,$2,$3,$4)',[session.share_code,'小林','gt','标准口味']),/几秒/);
  await assert.rejects(run('authenticated',a,"update public.tipsy_orders set guest_name='篡改' where id=$1",[order]),/permission denied/);
  assert.equal((await run('authenticated',b,"update public.tipsy_orders set status='done' where id=$1 returning *",[order])).rows.length,0);
  await run('authenticated',a,"update public.tipsy_orders set status='done' where id=$1",[order]);
  await run('authenticated',a,'update public.tipsy_sessions set is_open=false where id=$1',[session.id]);
  assert.equal((await run('anon',null,'select * from public.tipsy_public_menu($1)',[session.share_code])).rows.length,0);
  await assert.rejects(run('anon',null,'select public.tipsy_place_order($1,$2,$3,$4)',[session.share_code,'新朋友','gt','标准口味']),/关闭/);
  await db.close();
  console.log('PASS database: empty profiles, owner isolation, guest menu, validated/throttled orders, status-only updates, closed menus.');
})().catch(e=>{console.error(e);process.exit(1);});
