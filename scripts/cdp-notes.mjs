// CDP driver — verify the Supabase-backed NOTES tab end to end in the running
// dev app. Drives the real UI (click tab, create, edit, pin, search, delete)
// and confirms each step persisted to Supabase by re-listing from the server.
// Run while `FORGE_CDP=9222 npm run dev` is up:  node scripts/cdp-notes.mjs
const base = 'http://127.0.0.1:9222'
const targets = await (await fetch(`${base}/json`)).json()
const page = targets.find((t) => t.type === 'page' && t.title === 'Claude Forge')
if (!page) {
  console.log('FAIL: main "Claude Forge" page not found')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
await send('Runtime.enable')
const ev = async (body) => {
  const d = await send('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  // CDP nests the command payload under d.result: { result: RemoteObject, exceptionDetails? }
  const payload = d.result || {}
  if (payload.exceptionDetails) {
    throw new Error(
      'EVAL ERROR: ' +
        (payload.exceptionDetails.exception?.description || payload.exceptionDetails.text || '?')
    )
  }
  return payload.result ? payload.result.value : undefined
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const react = `function react(el,v){const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}`
let ok = true
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!cond) ok = false
}

// 1. Open NOTES tab, wait for server load.
await ev(`
  const b=[...document.querySelectorAll('.mode-tab')].find(x=>x.textContent.trim().toUpperCase().includes('NOTES'));
  if(!b) throw new Error('NOTES tab not found'); b.click();
`)
await sleep(1200)
const mount = await ev(`
  const root=document.querySelector('.nt-root');
  const pane=root&&root.closest('.view-pane');
  const sub=document.querySelector('.nt-bar-sub')?.textContent;
  const err=document.querySelector('.nt-error')?.textContent||'';
  return { hasRoot:!!root, vis:pane?getComputedStyle(pane).display:'none', sub, err,
           items:document.querySelectorAll('.nt-item').length };
`)
check('tab mounts + visible', mount.hasRoot && mount.vis === 'flex', `status="${mount.sub}"`)
check('no load error', !mount.err, mount.err)
const startCount = mount.items

// 2. Create a note via the UI → should POST to Supabase.
await ev(`document.querySelector('.nt-new').click();`)
await sleep(1000)
await ev(`
  ${react}
  react(document.querySelector('.nt-title-input'),'CDP Supabase note');
  react(document.querySelector('.nt-tags-input'),'cdp, supabase');
  react(document.querySelector('.nt-body-input'),'Persisted through window.forge.notes to PostgREST.');
`)
await sleep(900) // let the 500ms debounce flush the PATCH
const created = await ev(`
  return { items:document.querySelectorAll('.nt-item').length,
           top:document.querySelector('.nt-item-title')?.textContent };
`)
check('create adds a note', created.items === startCount + 1, `count ${startCount}→${created.items}`)

// 3. Persistence proof: re-list straight from the server via the bridge.
const persisted = await ev(`
  const list=await window.forge.notes.list();
  const hit=list.find(n=>n.title==='CDP Supabase note');
  return { total:list.length, found:!!hit, body:hit?.body, tags:hit?.tags, id:hit?.id };
`)
check('row persisted to Supabase', persisted.found, `server rows=${persisted.total}`)
check('body persisted', persisted.body === 'Persisted through window.forge.notes to PostgREST.')
check('tags persisted', JSON.stringify(persisted.tags) === JSON.stringify(['cdp', 'supabase']))

// 4. Pin → reorders into a Pinned group, and persists.
await ev(`[...document.querySelectorAll('.nt-icon-btn')].find(b=>/pin/i.test(b.textContent)).click();`)
await sleep(800)
const pinned = await ev(`
  const groups=[...document.querySelectorAll('.nt-group')].map(g=>g.textContent);
  const srv=await window.forge.notes.list();
  return { groups, serverPinned: srv.find(n=>n.id===${JSON.stringify(persisted.id)})?.pinned };
`)
check('pin shows Pinned group', pinned.groups.join().includes('Pinned'), `[${pinned.groups}]`)
check('pin persisted to server', pinned.serverPinned === true)

// 5. Search filters the list.
await ev(`${react} react(document.querySelector('.nt-search input'),'supabase');`)
await sleep(300)
const searched = await ev(`return document.querySelectorAll('.nt-item').length;`)
check('search filters', searched === 1, `shown=${searched}`)
await ev(`${react} react(document.querySelector('.nt-search input'),'');`)
await sleep(200)

// 6. Delete (cleanup) → gone from UI and from Supabase.
await ev(`[...document.querySelectorAll('.nt-icon-btn')].find(b=>/delete/i.test(b.textContent)).click();`)
await sleep(900)
const deleted = await ev(`
  const srv=await window.forge.notes.list();
  return { uiItems:document.querySelectorAll('.nt-item').length,
           stillOnServer: srv.some(n=>n.id===${JSON.stringify(persisted.id)}),
           total: srv.length };
`)
check('delete removes from server', !deleted.stillOnServer, `server rows=${deleted.total}`)
check('delete removes from UI', deleted.uiItems === startCount)

console.log(`\nVERDICT: ${ok ? 'PASS — Notes tab is fully wired to Supabase' : 'FAIL'}`)
ws.close()
process.exit(ok ? 0 : 1)
