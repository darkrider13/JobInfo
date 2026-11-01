// Teletalk Alljobs পেজ আসলে কীভাবে ডেটা আনে সেটা দেখার পরীক্ষামূলক স্ক্রিপ্ট।
// ফলাফল probe/ ফোল্ডারে জমা হয়, সেটা দেখে আসল ফেচার লেখা হবে।
const { chromium } = require('playwright');
const fs = require('fs');

const PAGES = [
  'https://alljobs.teletalk.com.bd/',
  'https://alljobs.teletalk.com.bd/jobs?orgid=1'
];

(async () => {
  const browser = await chromium.launch();
  const calls = [], texts = [];
  for (const url of PAGES) {
    const pg = await browser.newPage();
    pg.on('response', async r => {
      try {
        if (/json/.test(r.headers()['content-type'] || ''))
          calls.push({ page: url, url: r.url(), status: r.status(), body: (await r.text()).slice(0, 4000) });
      } catch (e) {}
    });
    try {
      await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await pg.waitForTimeout(3000);
      texts.push('=== ' + url + ' ===\n' + (await pg.innerText('body')).slice(0, 6000));
      const links = await pg.$$eval('a[href]', a => a.map(x => x.href).slice(0, 80));
      texts.push('LINKS:\n' + links.join('\n'));
    } catch (e) { texts.push('ব্যর্থ ' + url + ': ' + e.message); }
    await pg.close();
  }
  fs.mkdirSync('probe', { recursive: true });
  fs.writeFileSync('probe/teletalk-calls.json', JSON.stringify(calls, null, 2));
  fs.writeFileSync('probe/teletalk-text.txt', texts.join('\n\n'));
  await browser.close();
  console.log('API কল:', calls.length);
})();
