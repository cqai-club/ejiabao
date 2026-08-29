export const providerConfigPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>模型服务配置｜e剪宝</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,"Microsoft YaHei",sans-serif;background:#08091c;color:#f6f7ff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% 0,#252458 0,#0b0c22 45%,#070814 100%)}
    .wrap{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:48px 0 72px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:28px}
    h1{margin:0 0 8px;font-size:34px;letter-spacing:-.04em}p{color:#a9afd2;margin:0;line-height:1.7}.badge{display:inline-flex;padding:7px 12px;border:1px solid #343b76;border-radius:999px;color:#a8b5ff;font-size:13px}
    .panel{background:rgba(17,19,49,.9);border:1px solid #2a3270;border-radius:20px;box-shadow:0 24px 80px #02031366;padding:24px}.login{max-width:480px;margin:48px auto}.hidden{display:none!important}
    label{display:block;color:#b7bee3;font-size:13px;margin:0 0 8px}.field{margin:0 0 17px}input,select{width:100%;border:1px solid #343c78;border-radius:11px;background:#0c0e28;color:#f7f8ff;padding:12px 13px;font-size:14px;outline:none}input:focus,select:focus{border-color:#8c70ff;box-shadow:0 0 0 3px #8c70ff22}
    button{border:0;border-radius:11px;padding:12px 16px;font-weight:700;cursor:pointer;background:#8967ff;color:#0a0b1d}button.secondary{background:#20254d;color:#dfe2ff;border:1px solid #3a4279}button.danger{background:#40233d;color:#ffcfdf}button:disabled{opacity:.5;cursor:wait}
    .actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.hint{font-size:12px;color:#858db9}.notice{min-height:24px;margin-top:12px;color:#a9b7ff;font-size:13px}.error{color:#ff9fb2}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{padding:22px;background:linear-gradient(145deg,#171a3e,#10122d);border:1px solid #303875;border-radius:17px}.card h2{margin:0 0 6px;font-size:22px}.provider-label{color:#8d99d6;font-size:12px;text-transform:uppercase;letter-spacing:.12em;margin-bottom:18px}.status{display:inline-flex;border-radius:999px;padding:5px 9px;font-size:12px;margin:7px 0 20px;background:#25345a;color:#a9e9c8}.status.off{background:#3e2943;color:#ffb6c4}.mask{color:#969dc4;font-size:12px;margin-top:8px}.footer{margin-top:18px;color:#777fa8;font-size:12px}
    @media(max-width:760px){.grid{grid-template-columns:1fr}.top{display:block}.badge{margin-top:16px}}
  </style>
</head>
<body>
  <main class="wrap">
    <section id="loginPanel" class="panel login">
      <div class="badge">管理员入口</div><h1>模型服务配置</h1><p>登录后修改 DeepSeek Harness、Codex 与 InferFlow 的云端通道。API Key 只会加密保存，不会回显。</p>
      <form id="loginForm" style="margin-top:24px">
        <div class="field"><label for="account">邮箱或手机号</label><input id="account" autocomplete="username" required /></div>
        <div class="field"><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required /></div>
        <button type="submit">管理员登录</button><div id="loginNotice" class="notice"></div>
      </form>
    </section>
    <section id="appPanel" class="hidden">
      <div class="top"><div><div class="badge">e剪宝 · 服务配置中心</div><h1>模型服务配置</h1><p>修改后立即对新的中控请求生效。已有任务不会被重新切换模型。</p></div><button id="logout" class="secondary">退出</button></div>
      <div id="cards" class="grid"></div><div id="appNotice" class="notice"></div><div class="footer">安全提示：API Key 仅提交到后端并以 AES-256-GCM 加密保存；本页面不会写入浏览器本地存储。</div>
    </section>
  </main>
  <script>
    const serverPreviewMode=__ADMIN_PREVIEW_MODE__;
    const directAccess=__ADMIN_DIRECT_ACCESS__;
    let token="";
    const $=id=>document.getElementById(id);
    const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    function notice(message,error=false){$("appNotice").textContent=message;$("appNotice").className="notice"+(error?" error":"")}
    function api(path,options={}){return fetch(path,{...options,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,...(options.headers||{})}}).then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data?.error?.message||"请求失败");return data})}
    $("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("loginNotice").textContent="登录中…";const account=$("account").value.trim();try{const body=account.includes("@")?{email:account,password:$("password").value}:{phone:account,password:$("password").value};const data=await fetch("/v1/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||"登录失败");return d});if(!["ADMIN","SUPPORT"].includes(data.user?.role))throw new Error("当前账号没有后台配置权限");token=data.accessToken;$("loginPanel").classList.add("hidden");$("appPanel").classList.remove("hidden");await load()}catch(err){$("loginNotice").textContent=err.message;$("loginNotice").className="notice error"}});
    $("logout").onclick=()=>{token="";$("appPanel").classList.add("hidden");$("loginPanel").classList.remove("hidden");$("password").value=""};
    async function load(){try{const data=await api("/v1/admin/provider-configs");$("cards").innerHTML=data.providers.map(card).join("");data.providers.forEach(bind);if(data.preview){document.querySelectorAll("[data-action]").forEach(button=>button.disabled=true);notice("本机预览模式：数据库未连接，仅用于查看界面")}else{notice("配置已加载")}}catch(err){notice(err.message,true)}}
    function card(item){const key=item.provider;const title=key==="codex"?"Codex":key==="deepseek-harness"?"DeepSeek Harness":"InferFlow";const modelLabel=key==="inferflow"?"默认 Skill":"模型";const status=item.enabled?(item.apiKeyConfigured?'已启用':'待配置 API Key'):'已停用';return '<article class="card" data-provider="'+key+'"><div class="provider-label">'+esc(key)+'</div><h2>'+title+'</h2><span class="status '+(item.enabled&&item.apiKeyConfigured?'':'off')+'">'+status+'</span><div class="field"><label>接口地址</label><input data-field="baseUrl" value="'+esc(item.baseUrl)+'" /></div><div class="field"><label>'+modelLabel+'</label><input data-field="model" value="'+esc(item.model)+'" /></div>'+(key==="codex"?'<div class="field"><label>推理强度</label><select data-field="reasoningEffort"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></div>':'')+'<div class="field"><label>API Key（填写并保存后再测试）</label><input data-field="apiKey" type="password" placeholder="'+esc(item.apiKeyConfigured?item.apiKeyMasked:'请输入 API Key')+'" autocomplete="new-password" /><div class="mask">'+esc(item.source)+' · '+esc(item.apiKeyMasked)+'</div></div><div class="actions"><button data-action="save">保存配置</button><button data-action="test" class="secondary">测试连接</button><button data-action="toggle" class="danger">'+(item.enabled?'停用':'启用')+'</button></div></article>'}
    function bind(item){const root=document.querySelector('[data-provider="'+item.provider+'"]');if(!root)return;const select=root.querySelector('[data-field="reasoningEffort"]');if(select)select.value=item.reasoningEffort||"medium";root.querySelector('[data-action="save"]').onclick=()=>save(item.provider,root);root.querySelector('[data-action="test"]').onclick=()=>test(item.provider);root.querySelector('[data-action="toggle"]').onclick=()=>save(item.provider,root,!item.enabled)}
    function values(provider,root,enabledOverride){return {baseUrl:root.querySelector('[data-field="baseUrl"]').value.trim(),model:root.querySelector('[data-field="model"]').value.trim(),reasoningEffort:root.querySelector('[data-field="reasoningEffort"]')?.value||undefined,apiKey:root.querySelector('[data-field="apiKey"]').value.trim()||undefined,enabled:enabledOverride??true}}
    async function save(provider,root,enabledOverride){try{const existing=await api("/v1/admin/provider-configs");const current=existing.providers.find(x=>x.provider===provider);const data=await api('/v1/admin/provider-configs/'+provider,{method:"PUT",body:JSON.stringify(values(provider,root,enabledOverride??current?.enabled??true))});notice(provider+" 配置已保存");await load()}catch(err){notice(err.message,true)}}
    async function test(provider){try{const current=(await api("/v1/admin/provider-configs")).providers.find(item=>item.provider===provider);if(!current?.apiKeyConfigured){notice(provider+" 测试失败：请先填写 API Key 并保存配置。",true);return}notice("正在测试 "+provider+" …");const data=await api('/v1/admin/provider-configs/'+provider+'/test',{method:"POST",body:"{}"});notice(provider+" 连接成功："+(data.result?.text||"已收到响应"))}catch(err){notice(provider+" 测试失败："+err.message,true)}}
    if(serverPreviewMode||directAccess){$("loginPanel").classList.add("hidden");$("appPanel").classList.remove("hidden");$("logout").classList.add("hidden");load()}
  </script>
</body></html>`;
