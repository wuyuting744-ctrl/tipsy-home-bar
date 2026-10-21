# 微调 · Tipsy Club

居家调酒的网页原型，使用 GitHub Pages 托管静态页面，使用 Supabase Auth 和 PostgreSQL 保存账号数据。

- 网站：https://wuyuting744-ctrl.github.io/tipsy-home-bar/
- Supabase 项目：https://supabase.com/dashboard/project/popangetivmijcqnwohl

## 使用

注册邮箱账号，完成邮件验证后登录。新账号拥有空酒柜、空收藏和空个人配方；不会读取或导入旧 `tipsy-v1` 本地数据。

酒柜、收藏、个人配方保存到账号下。换设备登录即可读取；网页恢复焦点时会重新读取云端资料。每次修改只在数据库确认成功后更新页面；失败时保留表单内容。

主人开启点单后复制分享链接，朋友可在自己设备上免登录点单。主人工作台每 8 秒读取订单，也支持手动刷新；结束营业后旧链接停止接单。为供应个人配方，今晚菜单会发布被选中配方的快照，私人的酒柜和未选中的配方不会对朋友公开。

## 项目文件

- `app.js`：经典配方、插画和页面展示。
- `recipe-editor.js`：个人配方表单。
- `controller.js`：账号与数据交互、聚会菜单、订单队列。
- `cloud.js`：Supabase SDK 调用层。
- `supabase-config.js`：浏览器公开配置，仅允许 Publishable 或 anon key。
- `vendor/supabase.js`：固定版本的 Supabase SDK。
- `supabase/schema.sql`：建表、RLS、注册触发器和点单 RPC。
- `supabase/verify.sql`：在真实项目中验证 RLS 的回滚事务，不保留测试数据。

## 部署与认证配置

GitHub Pages 从 `main` 分支根目录发布。修改后提交并 `git push` 即可更新。

Supabase Authentication → URL Configuration 的 Site URL 应设为：

`https://wuyuting744-ctrl.github.io/tipsy-home-bar/`

新项目在 SQL Editor 执行 `supabase/schema.sql`；当前项目已初始化。保留邮箱验证。Supabase 默认邮件服务适合有限测试，正式向普通用户发送验证和重置邮件时，应在 Authentication → Emails 配置自己的 SMTP 服务并核对发送限制。

不要在网页中存放数据库密码、Service Role key 或 Secret key。Publishable key 可以公开；访问范围由 RLS 和 RPC 限制。账号密码由 Supabase Auth 处理，网页不保存密码。浏览器只保存 Supabase 登录会话，朋友昵称保存在当前标签页。

## 验证

安装 Node.js、Microsoft Edge，运行 `npm install`，再运行 `npm test`。

- `verify-database.cjs`：用本地 PostgreSQL 引擎执行实际 SQL，验证账号隔离、公共菜单、订单校验、节流与关闭营业。
- `verify.cjs`：真实 Supabase SDK + 模拟 HTTP 后端，覆盖邮件确认、登录、跨设备资料、保存失败、点单和手机布局，不发送测试邮件。

测试不会读取个人浏览器数据。页面字体使用 Google Fonts，网络不可用时回退到系统字体。
