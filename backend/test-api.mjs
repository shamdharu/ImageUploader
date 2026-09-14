import sharp from 'sharp';

const BASE = 'http://localhost:4000/api';
let failures = 0;

async function req(method, url, { body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  else data = await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}

function check(name, cond, extra = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${extra}`); }
}

async function login(email, password) {
  const r = await req('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status}`);
  return r.data.token;
}

const out = {};

// 1. health
{
  const r = await req('GET', '/health');
  check('health endpoint', r.status === 200 && r.data.ok === true);
}

// 2. login all roles
for (const [label, email, pw] of [
  ['admin', 'admin@demo.io', 'admin123'],
  ['manager', 'manager@demo.io', 'manager123'],
  ['contributor', 'contributor@demo.io', 'contributor123'],
  ['viewer', 'viewer@demo.io', 'viewer123'],
]) {
  const t = await login(email, pw);
  out[label] = t;
  check(`${label} login`, !!t);
}
check('bad login rejected', (await req('POST', '/auth/login', { body: { email: 'admin@demo.io', password: 'wrong' } })).status === 401);
check('missing token rejected', (await req('GET', '/categories')).status === 401);

// 3. categories per role
for (const role of ['admin', 'manager', 'contributor', 'viewer']) {
  const r = await req('GET', '/categories', { token: out[role] });
  const ids = r.data.categories.map((c) => c.id);
  out[`${role}Cats`] = ids;
  console.log(`  INFO ${role} categories: [${ids.join(', ')}]`);
}
check('admin sees both seeded categories', out.adminCats.includes(1001) && out.adminCats.includes(1002));
check('viewer restricted to category 1001', JSON.stringify(out.viewerCats) === JSON.stringify([1001]));
check('contributor sees 1001+1002', out.contributorCats.length === 2);
check('manager sees both categories', out.managerCats.length === 2);

// 4. category create
{
  const ok = await req('POST', '/categories', { token: out.admin, body: { name: 'Archive 2001' } });
  check('admin creates category', ok.status === 201, `-> ${ok.status}`);
  const deny = await req('POST', '/categories', { token: out.viewer, body: { name: 'Nope' } });
  check('viewer cannot create category', deny.status === 403);
}

// 5. image list in 1001
{
  const r = await req('GET', '/images?categoryId=1001', { token: out.admin });
  const imgs = r.data.images;
  check('admin lists the 3 seeded images in 1001', r.status === 200 && imgs.length >= 3, `got ${imgs.length}`);
  out.firstImageId = imgs[0]?.id;
  check('image rows carry thumbnailUrl + variants', !!imgs[0]?.thumbnailUrl && imgs[0].variants.length >= 2);
}

// 6. viewer forbidden from category 1002
{
  const deny = await req('GET', '/images?categoryId=1002', { token: out.viewer });
  check('viewer blocked from category 1002', deny.status === 403);
}

// 7. file serving permission checks
{
  const id = out.firstImageId;
  const thumb = await req('GET', `/images/${id}/file?variant=thumbnail`, { token: out.viewer });
  check('viewer fetches thumbnail (200, image/webp)', thumb.status === 200 && thumb.headers.get('content-type') === 'image/webp' && thumb.data.byteLength > 0);
  const hd = await req('GET', `/images/${id}/file?variant=hd`, { token: out.viewer });
  check('viewer denied HD variant', hd.status === 403);
  const orig = await req('GET', `/images/${id}/file?variant=original`, { token: out.viewer });
  check('viewer denied original', orig.status === 403);
  const print = await req('GET', `/images/${id}/file?variant=print`, { token: out.viewer });
  check('viewer denied print', print.status === 403);
}

// 8. download action: contributor limited to web, admin full
{
  const id = out.firstImageId;
  const contribWeb = await req('POST', `/images/${id}/download`, { token: out.contributor, body: { variant: 'web' } });
  check('contributor downloads web resolution', contribWeb.status === 200 && !!contribWeb.data.url);
  const contribHd = await req('POST', `/images/${id}/download`, { token: out.contributor, body: { variant: 'hd' } });
  check('contributor blocked from HD download', contribHd.status === 403);
  const adminOrig = await req('POST', `/images/${id}/download`, { token: out.admin, body: { variant: 'original' } });
  check('admin downloads original', adminOrig.status === 200);
}

// 9. print action: viewer denied, manager allowed on owned 1002
{
  const id = out.firstImageId;
  const viewerPrint = await req('POST', `/images/${id}/print`, { token: out.viewer });
  check('viewer blocked from print', viewerPrint.status === 403);
  const mgrOwned = await req('POST', `/images/4/print`, { token: out.manager });
  check('manager prints own-category image', mgrOwned.status === 200 && !!mgrOwned.data.url);
}

// 10. upload + job progress + duplicate detection
{
  const rgb = () => Math.floor(Math.random() * 255);
  const buf = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: rgb(), g: rgb(), b: rgb() } } }).png().toBuffer();
  const fd = new FormData();
  fd.append('categoryId', '1001');
  fd.append('source', 'webcam');
  fd.append('file', new File([buf], `fresh-test-${Date.now()}.png`, { type: 'image/png' }));
  const ul = await fetch(BASE + '/images/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + out.admin }, body: fd });
  const ulj = await ul.json();
  const accepted = ul.status === 202 && !!ulj.jobId;
  check('upload accepted (202 + jobId)', accepted, `-> ${ul.status}: ${ulj.error}`);

  let jobDone = !accepted;
  if (accepted) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        const j = await req('GET', `/jobs/${ulj.jobId}`, { token: out.admin });
        if (j.data.job.status === 'completed') {
          jobDone = true;
          check(`job completed (progress ${j.data.job.progressPercent}%)`, j.data.job.progressPercent === 100);
          break;
        }
      } catch {
        /* transient */
      }
    }
  }
  check('processing job eventually completed', jobDone);

  const single = await req('GET', `/images/${ulj.imageId}`, { token: out.admin });
  check('new image is ready with 5 variants', single.data.image.status === 'ready' && single.data.variants.length === 5, `v=${single.data.variants.length}`);
  check('new image exposes independent permission set', !!single.data.permissions && !!single.data.permissions.maxDownload);

  const fd2 = new FormData();
  fd2.append('categoryId', '1001');
  fd2.append('source', 'file_upload');
  fd2.append('file', new File([buf], 'fresh-test-copy.png', { type: 'image/png' }));
  const dup = await fetch(BASE + '/images/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + out.admin }, body: fd2 });
  const dupj = await dup.json();
  check('duplicate upload rejected (409)', dup.status === 409, `-> ${dup.status}: ${dupj.error}`);
}

// 11. audit log
{
  const r = await req('GET', '/admin/audit', { token: out.admin });
  check('audit log returns entries', r.status === 200 && r.data.entries.length >= 5, `n=${r.data.entries.length}`);
  const deny = await req('GET', '/admin/audit', { token: out.viewer });
  check('audit log admin-only', deny.status === 403);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);