// RSS থেকে নতুন পোস্ট খুঁজে, Claude দিয়ে তথ্য বের করে www/circulars.json আপডেট করে।
const fs = require('fs');
const crypto = require('crypto');

const OUT = 'www/circulars.json';
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const MAX_NEW_PER_RUN = 10;
const today = new Date().toISOString().slice(0, 10);

const sources = JSON.parse(fs.readFileSync('sources.json', 'utf8'));
const list = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const seen = new Set(list.map(c => c.source).filter(Boolean));

const tag = (x, t) => {
  const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};
const toText = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function extract(text) {
  const prompt = `নিচের লেখাটি একটি চাকরির পোস্ট। শুধু JSON দিন (কোনো ব্যাখ্যা নয়):
{"is_recruitment": true/false, "org": "প্রতিষ্ঠান (বাংলায়)", "title": "পদের নাম (বাংলায়)",
"category": "বিসিএস/ব্যাংক/শিক্ষা/রেলওয়ে/প্রতিরক্ষা/অন্যান্য", "vacancies": সংখ্যা বা 0,
"deadline": "YYYY-MM-DD বা null", "qualification": "সংক্ষেপে", "ageLimit": "সংক্ষেপে"}
নিয়োগ বিজ্ঞপ্তি না হলে (ফল, প্রবেশপত্র, সিট প্ল্যান ইত্যাদি) is_recruitment=false দিন। আজকের তারিখ ${today}।

লেখা:
${text.slice(0, 7000)}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error('Claude API ' + r.status);
  const t = (await r.json()).content.map(b => b.text || '').join('');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

(async () => {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY secret সেট করা নেই');
  let added = 0;
  for (const src of sources) {
    let xml;
    try { xml = await (await fetch(src.feed)).text(); } catch (e) { console.log('feed ব্যর্থ:', src.feed, e.message); continue; }
    const items = xml.split('<item>').slice(1, 16).map(x => ({ title: tag(x, 'title'), link: tag(x, 'link'), pub: tag(x, 'pubDate') }));
    for (const it of items) {
      if (added >= MAX_NEW_PER_RUN) break;
      if (!it.link || seen.has(it.link)) continue;
      seen.add(it.link);
      try {
        const html = await (await fetch(it.link)).text();
        const info = await extract(it.title + '\n' + toText(html));
        if (!info.is_recruitment || !info.deadline || info.deadline < today) { console.log('বাদ:', it.title); continue; }
        const pdf = (html.match(/href="([^"]+\.pdf)"/i) || [])[1] || '';
        const apply = (html.match(/href="(https?:\/\/[^"]*teletalk\.com\.bd[^"]*)"/i) || [])[1] || '';
        list.unshift({
          id: 'a' + crypto.createHash('md5').update(it.link).digest('hex').slice(0, 10),
          org: info.org, title: info.title, category: info.category || 'অন্যান্য', vacancies: Number(info.vacancies) || 0,
          deadline: info.deadline, publishedAt: it.pub ? new Date(it.pub).toISOString().slice(0, 10) : today,
          qualification: info.qualification || '', ageLimit: info.ageLimit || '', pdf, applyLink: apply, source: it.link
        });
        added++; console.log('যোগ:', info.title);
      } catch (e) { console.log('ব্যর্থ:', it.link, e.message); }
    }
  }
  // মেয়াদ শেষের ৩০ দিন পরে মুছে ফেলা
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const out = list.filter(c => c.deadline >= cutoff);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`নতুন ${added}টি, মোট ${out.length}টি`);
})();
