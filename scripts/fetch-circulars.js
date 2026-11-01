// সম্পূর্ণ বিনামূল্যে: কোনো API key বা পেইড সার্ভিস লাগে না।
// RSS থেকে নতুন পোস্ট এনে নিয়ম (regex) দিয়ে তথ্য বের করে www/circulars.json আপডেট করে।
const fs = require('fs');
const crypto = require('crypto');

const OUT = 'www/circulars.json';
const SEEN = 'scripts/seen.json'; // যেসব পোস্ট বাদ দেওয়া হয়েছে, বারবার দেখার দরকার নেই
const MAX_NEW = 30;
const today = new Date().toISOString().slice(0, 10);

const BN = '০১২৩৪৫৬৭৮৯';
const en = s => s.replace(/[০-৯]/g, d => BN.indexOf(d));
const MONTHS = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  'জানুয়ারি': 1, 'ফেব্রুয়ারি': 2, 'মার্চ': 3, 'এপ্রিল': 4, 'মে': 5, 'জুন': 6, 'জুলাই': 7, 'আগস্ট': 8,
  'সেপ্টেম্বর': 9, 'অক্টোবর': 10, 'নভেম্বর': 11, 'ডিসেম্বর': 12 };
const monthAlt = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function findDates(t) {
  const out = [];
  const y0 = new Date().getFullYear();
  const fix = (d, m, y, idx) => {
    d = +d; m = +m; if (d < 1 || d > 31 || m < 1 || m > 12) return;
    let year = y ? +y : y0;
    let s = iso(year, m, d);
    if (!y && s < iso(y0, new Date().getMonth() + 1, 1)) s = iso(y0 + 1, m, d);
    out.push({ iso: s, idx });
  };
  let m;
  const r1 = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?[\\s,\\-]*(${monthAlt})(?![a-zA-Z])[\\s,\\-]*(\\d{4})?`, 'gi');
  while ((m = r1.exec(t))) fix(m[1], MONTHS[m[2].toLowerCase()], m[3], m.index);
  const r2 = new RegExp(`(${monthAlt})(?![a-zA-Z])[\\s,\\-]*(\\d{1,2})(?:st|nd|rd|th)?[\\s,]+(\\d{4})`, 'gi');
  while ((m = r2.exec(t))) fix(m[2], MONTHS[m[1].toLowerCase()], m[3], m.index);
  const r3 = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g;
  while ((m = r3.exec(t))) fix(m[1], m[2], m[3], m.index);
  return out;
}

function pickDeadline(text) {
  const t = en(text);
  const kw = /(deadline|last date|last day|closing|until|till|শেষ\s*[:：]|শেষ তারিখ|শেষ সময়|শেষ দিন|আবেদনের শেষ|আবেদন শেষ|পর্যন্ত)/i;
  const near = findDates(t).filter(d => kw.test(t.slice(Math.max(0, d.idx - 90), d.idx + 70))).map(d => d.iso);
  return near.length ? near.sort().pop() : null;
}
function vacancies(s) {
  s = en(s);
  const m = s.match(/(\d[\d,]*)\s*(?:টি\s*)?(?:জন\s*)?পদে/) || s.match(/total\s*posts?\s*[:\-]?\s*(\d[\d,]*)/i) || s.match(/(\d[\d,]*)\s*(?:posts|vacancies)/i);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}
function category(s) {
  if (/ব্যাংক|bank/i.test(s)) return 'ব্যাংক';
  if (/বিসিএস|bcs/i.test(s)) return 'বিসিএস';
  if (/রেলওয়ে|railway/i.test(s)) return 'রেলওয়ে';
  if (/সেনা|army|police|পুলিশ|bgb|navy|নৌ|air force|বিমান|আনসার|ansar|defen[cs]e/i.test(s)) return 'প্রতিরক্ষা';
  if (/শিক্ষ|teacher|university|বিশ্ববিদ্যালয়|school|college|ntrca/i.test(s)) return 'শিক্ষা';
  return 'অন্যান্য';
}
const orgFrom = t => (t.replace(/[\d০-৯,]+\s*(টি\s*)?পদে/g, ' ')
  .replace(/নিয়োগ বিজ্ঞপ্তি|job circular|recruitment|circular|প্রকাশিত|বিশাল|[\d০-৯]{4}|[!|:–-]/gi, ' ')
  .replace(/\s+/g, ' ').trim()) || t;
const SKIP = /result|রেজাল্ট|ফলাফল|admit|প্রবেশপত্র|seat plan|সিট প্ল্যান|routine|রুটিন|syllabus|সিলেবাস|answer key/i;

const tag = (x, t) => {
  const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};
const toText = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&#8212;/g, '-').replace(/\s+/g, ' ').trim();

async function main() {
  const sources = JSON.parse(fs.readFileSync('sources.json', 'utf8'));
  const list = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const skipped = fs.existsSync(SEEN) ? JSON.parse(fs.readFileSync(SEEN, 'utf8')) : [];
  const seen = new Set([...list.map(c => c.source).filter(Boolean), ...skipped]);
  let added = 0;
  for (const src of sources) {
    let xml;
    try { xml = await (await fetch(src.feed)).text(); } catch (e) { console.log('feed ব্যর্থ:', src.feed, e.message); continue; }
    const items = xml.split('<item>').slice(1, 21);
    for (const x of items) {
      if (added >= MAX_NEW) break;
      const title = toText(tag(x, 'title')), link = tag(x, 'link'), pub = tag(x, 'pubDate');
      if (!link || seen.has(link)) continue;
      seen.add(link); // একই পোস্ট দুই ফিডে এলে একবারই নেবে
      if (SKIP.test(title)) { skipped.push(link); console.log('বাদ (ফল/রুটিন):', title); continue; }
      try {
        let html = tag(x, 'content:encoded') || tag(x, 'description');
        if (toText(html).length < 400) html = await (await fetch(link)).text();
        const art = (html.match(/<article[\s\S]*?<\/article>/i) || [html])[0];
        const text = toText(art);
        const deadline = pickDeadline(title + ' ' + text);
        if (!deadline || deadline < today) { skipped.push(link); console.log('বাদ (তারিখ নেই/শেষ):', title); continue; }
        const pdf = (art.match(/href="([^"]+\.pdf)"/i) || [])[1] || '';
        const apply = (art.match(/href="(https?:\/\/[^"]*teletalk\.com\.bd[^"]*)"/i) || [])[1] || '';
        const q = text.match(/(?:শিক্ষাগত যোগ্যতা|educational qualification|qualification)\s*[:：\-]?\s*([^.।]{10,160})/i);
        const a = text.match(/(?:বয়সসীমা|বয়স|age limit|age)\s*[:：\-]?\s*([^.।]{3,60})/i);
        list.unshift({
          id: 'a' + crypto.createHash('md5').update(link).digest('hex').slice(0, 10),
          org: orgFrom(title), title, category: category(title), vacancies: vacancies(title + ' ' + text.slice(0, 600)),
          deadline, publishedAt: pub ? new Date(pub).toISOString().slice(0, 10) : today,
          qualification: q ? q[1].trim() : '', ageLimit: a ? a[1].trim() : '', pdf, applyLink: apply, source: link
        });
        added++; console.log('যোগ:', title, '→', deadline);
      } catch (e) { console.log('ব্যর্থ:', link, e.message); }
    }
  }
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const out = list.filter(c => c.deadline >= cutoff);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  fs.writeFileSync(SEEN, JSON.stringify(skipped.slice(-500), null, 2));
  console.log(`নতুন ${added}টি, মোট ${out.length}টি`);
}
if (require.main === module) main(); else module.exports = { pickDeadline, vacancies, category, orgFrom };
