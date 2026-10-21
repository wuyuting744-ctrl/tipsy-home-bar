/* Supabase is the only durable store for account data. No local profile migration. */
window.TipsyCloud = (() => {
  const config = window.TIPSY_SUPABASE_CONFIG || {};
  let client = null;
  let configurationError = '';
  const key = String(config.publishableKey || '').trim();
  try {
    if (config.url && key) {
      const url = new URL(config.url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw Error('请配置有效的 Supabase Project URL');
      if (key.startsWith('sb_secret_')) throw Error('网页只能使用 Publishable key，不能使用 Secret key');
      if (key.split('.').length === 3) {
        const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role !== 'anon') throw Error('网页只能使用 anon public key，不能使用 service_role');
      } else if (!key.startsWith('sb_publishable_')) throw Error('请配置有效的 Publishable key');
      if (!window.supabase?.createClient) throw Error('账号服务未能加载，请检查网络后刷新');
      client = window.supabase.createClient(url.href.replace(/\/$/, ''), key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'tipsy-supabase-auth' }
      });
    }
  } catch (e) { configurationError = e.message; }

  const result = async request => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data;
  };
  const requireClient = () => {
    if (!client) throw Error(configurationError || '账号服务尚未配置，请先完成 Supabase 项目连接');
    return client;
  };
  const redirectUrl = () => {
    const url = new URL(window.location.href);
    url.search = ''; url.hash = '';
    return url.href;
  };
  const message = error => {
    const text = error?.message || '连接失败，请稍后重试';
    if (/Invalid login credentials/i.test(text)) return '邮箱或密码不正确';
    if (/Email not confirmed/i.test(text)) return '请先打开注册邮件，验证邮箱后再登录';
    if (/User already registered/i.test(text)) return '这个邮箱已注册，请直接登录';
    if (/rate limit|too many|over_email_send/i.test(text)) return '操作过于频繁，请稍后重试';
    if (/fetch|network|Failed to/i.test(text)) return '网络连接失败，请检查网络后重试';
    if (/relation|schema cache|does not exist/i.test(text)) return '云端数据库尚未初始化，请执行项目中的建表脚本';
    if (/row-level security|permission denied/i.test(text)) return '当前账号无权操作这份数据，请重新登录';
    return text;
  };
  const ownQuery = (table, userId) => requireClient().from(table).select('*').eq('user_id', userId).maybeSingle();
  const cleanRecipes = list => (Array.isArray(list) ? list : []).filter(r => r && /^[a-z0-9-]{1,80}$/.test(r.id || '')
    && Array.isArray(r.parts) && r.parts.length && Array.isArray(r.steps) && r.steps.length).map(r => {
    const color = v => /^#[0-9a-f]{3,8}$/i.test(v || '') ? v : '#eadcc6';
    const text = (v, max = 600) => String(v || '').slice(0, max);
    return { id:r.id, name:text(r.name,24), en:text(r.en,100), type:['coupe','highball','rocks','martini'].includes(r.type)?r.type:'coupe',
      color:color(r.color), liquid:color(r.liquid), flavors:(Array.isArray(r.flavors)?r.flavors:[]).slice(0,3).map(v=>text(v,16)),
      strength:['轻盈','适中','浓郁','无酒精'].includes(r.strength)?r.strength:'适中',time:Math.min(60,Math.max(1,Number(r.time)||5)),
      parts:r.parts.filter(p=>Array.isArray(p)&&p.length===2).slice(0,30).map(p=>[text(p[0],40),text(p[1],80)]),
      steps:r.steps.slice(0,30).map(v=>text(v)),story:text(r.story),garnish:text(r.garnish,80),custom:true };
  });
  return {
    configured: !!client,
    configurationError,
    message,
    session: () => result(requireClient().auth.getSession()).then(data => data.session),
    listen: callback => requireClient().auth.onAuthStateChange((event, session) => {
      // SDK callbacks must return without awaiting any auth/database call.
      setTimeout(() => callback(event, session), 0);
    }).data.subscription,
    signIn: (email, password) => result(requireClient().auth.signInWithPassword({ email, password })),
    signUp: (email, password, name) => result(requireClient().auth.signUp({
      email, password, options: { data: { display_name: name }, emailRedirectTo: redirectUrl() }
    })),
    signOut: () => result(requireClient().auth.signOut({ scope: 'local' })),
    resetPassword: email => result(requireClient().auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() })),
    updatePassword: password => result(requireClient().auth.updateUser({ password })),
    async load(user) {
      let [personal, bar] = await Promise.all([result(ownQuery('tipsy_profiles', user.id)), result(ownQuery('tipsy_bar_data', user.id))]);
      // Covers users created before the trigger; initial cloud data is always empty.
      if (!personal) personal = await result(requireClient().from('tipsy_profiles').insert({ user_id: user.id, display_name: user.user_metadata?.display_name || '调酒爱好者' }).select().single());
      if (!bar) bar = await result(requireClient().from('tipsy_bar_data').insert({ user_id: user.id }).select().single());
      return { name: personal.display_name, stock: bar.stock || [], favs: bar.favorites || [], custom: cleanRecipes(bar.custom_recipes), orders: [], menu: [], open: false };
    },
    async patch(userId, fields) {
      return result(requireClient().from('tipsy_bar_data').update({ ...fields, updated_at: new Date().toISOString() }).eq('user_id', userId).select().single());
    },
    async party(userId) {
      const rows = await result(requireClient().from('tipsy_sessions').select('*').eq('owner_id', userId).order('created_at', { ascending: false }).limit(1));
      return rows[0] || null;
    },
    orders: sessionId => result(requireClient().from('tipsy_orders').select('*').eq('session_id', sessionId).order('created_at')),
    async publish(userId, name, menu, published, session) {
      const fields = { bar_name: name, menu, published_recipes: published, updated_at: new Date().toISOString() };
      if (session?.is_open) return result(requireClient().from('tipsy_sessions').update(fields).eq('id', session.id).eq('owner_id', userId).select().single());
      return result(requireClient().from('tipsy_sessions').insert({ ...fields, owner_id: userId }).select().single());
    },
    close: (userId, sessionId) => result(requireClient().from('tipsy_sessions').update({ is_open: false, updated_at: new Date().toISOString() }).eq('id', sessionId).eq('owner_id', userId).select().single()),
    updateOrder: (id, status) => result(requireClient().from('tipsy_orders').update({ status }).eq('id', id).select().single()),
    async publicMenu(code) {
      const rows = await result(requireClient().rpc('tipsy_public_menu', { p_share_code: code }));
      return rows[0] ? { ...rows[0], published_recipes: cleanRecipes(rows[0].published_recipes) } : null;
    },
    placeOrder: (code, name, recipeId, sweetness) => result(requireClient().rpc('tipsy_place_order', {
      p_share_code: code, p_guest_name: name, p_recipe_id: recipeId, p_sweetness: sweetness
    }))
  };
})();
