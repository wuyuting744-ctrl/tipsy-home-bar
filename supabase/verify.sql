-- Disposable database transaction: creates fixtures, validates hosted RLS, then rolls back.
begin;

insert into auth.users(id, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111', '{"display_name":"RLS verification A"}'),
 ('22222222-2222-4222-8222-222222222222', '{"display_name":"RLS verification B"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
begin
  assert (select count(*) from public.tipsy_bar_data) = 1, 'Profile isolation failed';
  assert (select stock = '{}'::text[] from public.tipsy_bar_data), 'New profile must be empty';
  update public.tipsy_bar_data set stock = array['金酒','汤力水'];
  insert into public.tipsy_sessions(owner_id,share_code,menu,bar_name)
  values ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',array['gt'],'RLS verification bar');
end;
$$;

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare v_count integer;
begin
  assert (select stock = '{}'::text[] from public.tipsy_bar_data), 'Cross-account read failed';
  assert (select count(*) from public.tipsy_sessions) = 0, 'Private sessions leaked';
  update public.tipsy_bar_data set stock = '{}' where user_id='11111111-1111-4111-8111-111111111111';
  get diagnostics v_count = row_count;
  assert v_count = 0, 'Cross-account write failed';
end;
$$;

set local role anon;
do $$
begin
  assert (select count(*) from public.tipsy_public_menu('33333333-3333-4333-8333-333333333333')) = 1, 'Public menu unavailable';
  perform public.tipsy_place_order('33333333-3333-4333-8333-333333333333','Verification Guest','gt','标准口味');
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
  assert (select count(*) from public.tipsy_orders) = 0, 'Orders leaked to another owner';
end; $$;

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  assert (select count(*) from public.tipsy_orders) = 1, 'Owner cannot read order';
  update public.tipsy_orders set status='done';
  update public.tipsy_sessions set is_open=false;
end; $$;

set local role anon;
do $$ begin
  assert (select count(*) from public.tipsy_public_menu('33333333-3333-4333-8333-333333333333')) = 0, 'Closed menu still available';
end; $$;

rollback;
