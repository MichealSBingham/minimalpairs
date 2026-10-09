// Test-only browser host. Real UI/client/storage code; synthetic identity and
// entitlement boundaries. Never imports owner credentials or app .env.
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const app = fileURLToPath(new URL('../../', import.meta.url));
const boundary = `
const params = new URLSearchParams(location.search);
const makeUser = (id = 'fixture-buyer', verified = true) => ({id,email:id+'@example.invalid',email_verified:verified,providers:['google.com'],user_metadata:{}});
let user = params.get('user') === 'guest' ? null : makeUser('fixture-buyer',params.get('user') !== 'unverified');
let access = params.get('access') === 'lifetime' ? {active:true,plan:'lifetime',source:'legacy-purchase'} : params.get('access') === 'monthly' ? {active:true,plan:'monthly',source:'subscription'} : null;
const listeners = new Set();
const calls = [];
window.billingFixture = {calls, switchAccount(id){user=id ? makeUser(id) : null; for(const listener of listeners) listener(user ? {user} : null);}, setAccess(value){access=value;}, failRead:false};
export function observeSession(listener){calls.push({kind:'observe'}); listeners.add(listener); listener(user ? {user} : null); return ()=>listeners.delete(listener);}
export async function getSession(){return user ? {user} : null;}
export async function refreshSession(){calls.push({kind:'refresh'});return getSession();}
export async function getFreshVerifiedIdToken(id){calls.push({kind:'token',id});if(user?.id!==id || !user.email_verified)throw Error('Fixture account mismatch');return 'synthetic-fixture-token-not-a-credential';}
export async function getEntitlement(options){calls.push({kind:'server-access',options});if(options?.fresh!==true || options?.expectedUserId!==user?.id)throw Error('Fresh expected-account read required');if(window.billingFixture.failRead)throw Error('The access server is unavailable. Try again shortly.');return access;}
`;
export async function startMembershipFixture() {
  const bundles = {};
  for (const enabled of [true, false]) {
    const result = await build({
      stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import MembershipPanel from './src/components/MembershipPanel'; import './src/styles/global.css'; createRoot(document.getElementById('root')).render(<MembershipPanel/>);`, resolveDir: app, loader: 'tsx' },
      external: ['/fonts/*'],
      bundle: true, write: false, outdir: '/fixture', format: 'esm', jsx: 'automatic',
      define: { 'import.meta.env': JSON.stringify({ PUBLIC_BILLING_ENABLED: String(enabled), PUBLIC_BILLING_CHECKOUT_ENABLED: 'true', PUBLIC_BILLING_API_ORIGIN: 'https://billing.example.invalid' }) },
      plugins: [{ name: 'synthetic-account-boundary', setup(plugin) {
        plugin.onResolve({ filter: /(?:^|\/)(?:auth|entitlements)$/ }, args => /src\/(components|lib)\//.test(args.importer) ? { path: 'account', namespace: 'fixture' } : null);
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: boundary, loader: 'js' }));
      } }],
    });
    bundles[enabled ? 'enabled' : 'disabled'] = Object.fromEntries(result.outputFiles.map(file => [file.path.endsWith('.css') ? 'css' : 'js', file.text]));
  }
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    if (url.pathname.startsWith('/fonts/')) { response.writeHead(404); response.end(); return; }
    const name = url.pathname.startsWith('/disabled') ? 'disabled' : 'enabled';
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
      const type = url.pathname.endsWith('.css') ? 'css' : 'js'; response.setHeader('Content-Type', type === 'css' ? 'text/css' : 'text/javascript'); response.end(bundles[name][type]); return;
    }
    response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/${name}.css"></head><body><main class="${url.searchParams.has('sidebar') ? 'account-aside' : ''}" style="max-width:${url.searchParams.has('sidebar') ? '320' : '740'}px;margin:30px auto;padding:${url.searchParams.has('sidebar') ? '0' : '20'}px"><h1>Membership fixture</h1><div id="root"></div></main><script type="module" src="/${name}.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
