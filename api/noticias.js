// /api/noticias — rota serverless nas mesmas regras do backend C# (SextaFace.cs):
//   · consulta GERAL  → G1 (img no <description>) + BBC Brasil (media:thumbnail), alternados
//   · busca específica→ Bing News RSS (News:Image) com título/url/imagem/fonte
// Saída: { ok, mensagem?, items: [{title,data,url,image,source}] } — idêntico ao /api/noticias do exe
const FEEDS = {
  g1: 'https://g1.globo.com/rss/g1/',
  bbc: 'https://feeds.bbci.co.uk/portuguese/rss.xml',
  bing: 'https://www.bing.com/news/search'
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const crawlerUA = 'Mozilla/5.0 (compatible; SextaFace NewsBot/1.0; +http://localhost)';

function decodeHtml(value) {
  if (!value) return '';
  const swap = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", '#039':"'", '#39':"'" };
  return String(value).replace(/&([^;]+);/g, (m, c) => swap[c] || (c.startsWith('#') ? String.fromCharCode(parseInt(c.slice(1), 10)) : m));
}
function firstTag(bloco, tag) {
  const re = new RegExp('<' + tag + '[^>]*>(.*?)</' + tag + '>', 'is');
  const m = re.exec(bloco);
  return m ? m[1] : '';
}
function htmlClean(raw) {
  if (!raw) return '';
  return String(raw).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function isGeral(q) {
  return /^(not[íi]cias?|not[íi]cias do mundo|mundo|tudo|ultimas|últimas|hoje|geral|manchetes)$/i.test(String(q||'').trim());
}

// G1: imagem dentro do <description> como <img src="..."> (CDATA)
async function rssG1() {
  const out = [];
  try {
    const r = await fetch(FEEDS.g1, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(9000) });
    const xml = await r.text();
    const re = /<item>(.*?)<\/item>/gis;
    let m, n = 0;
    while ((m = re.exec(xml)) && n < 6) {
      const b = m[1];
      const title = decodeHtml(firstTag(b, 'title'));
      const link = decodeHtml(firstTag(b, 'link'));
      const pub = decodeHtml(firstTag(b, 'pubDate'));
      const desc = firstTag(b, 'description');
      const im = /<img[^>]+src=["']([^"']+)["']/i.exec(desc);
      const image = im ? im[1] : '';
      if (title) {
        out.push({ title, data: pub ? pub.substring(0, Math.min(16, pub.length)) : '', url: link, image, source: 'G1' });
        n++;
      }
    }
  } catch {}
  return out;
}

// BBC Brasil: media:thumbnail url=... + media:credit
async function rssBBC() {
  const out = [];
  try {
    const r = await fetch(FEEDS.bbc, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(9000) });
    const xml = await r.text();
    const re = /<item>(.*?)<\/item>/gis;
    let m, n = 0;
    while ((m = re.exec(xml)) && n < 6) {
      const b = m[1];
      const title = decodeHtml(firstTag(b, 'title'));
      const link = decodeHtml(firstTag(b, 'link'));
      const pub = decodeHtml(firstTag(b, 'pubDate'));
      const th = /<media:thumbnail[^>]+url=["']([^"']+)["']/i.exec(b);
      const image = th ? th[1] : '';
      if (title) {
        out.push({ title, data: pub ? pub.substring(0, Math.min(16, pub.length)) : '', url: link, image, source: 'BBC' });
        n++;
      }
    }
  } catch {}
  return out;
}

// Bing News: News:Image (thumbnail) + News:Source; link real dentro apiclick?url=
async function rssBing(q) {
  const out = [];
  try {
    const url = FEEDS.bing + '?q=' + encodeURIComponent(q) + '&format=RSS&setlang=pt-br';
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(9000) });
    const xml = await r.text();
    const re = /<item>(.*?)<\/item>/gis;
    let m, n = 0;
    while ((m = re.exec(xml)) && n < 8) {
      const b = m[1];
      const title = decodeHtml(firstTag(b, 'title'));
      let link = decodeHtml(firstTag(b, 'link'));
      const u = /[?&]url=([^&]+)/i.exec(link);
      if (u) { try { link = decodeURIComponent(u[1]); } catch {} }
      const im = /<News:Image>(.*?)<\/News:Image>/is.exec(b);
      const image = im ? decodeHtml(im[1]) : '';
      const src = decodeHtml(firstTag(b, 'News:Source'));
      const pub = decodeHtml(firstTag(b, 'pubDate'));
      if (title) {
        out.push({ title, data: pub ? pub.substring(0, Math.min(16, pub.length)) : '', url: link, image, source: src || 'Bing News' });
        n++;
      }
    }
  } catch {}
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const q = (req.query.q || '').trim() || 'noticias';
  let items = [];
  try {
    if (isGeral(q)) {
      const [a1, a2] = await Promise.all([rssG1(), rssBBC()]);
      // intercala G1/BBC = "tudo e sobre tudo" (várias fontes na tela), até 8
      let i = 0, j = 0;
      while (items.length < 8 && (i < a1.length || j < a2.length)) {
        if (i < a1.length) items.push(a1[i++]);
        if (items.length < 8 && j < a2.length) items.push(a2[j++]);
      }
    } else {
      items = await rssBing(q);
    }
  } catch {}

  return res.status(200).json({
    ok: items.length > 0,
    mensagem: items.length > 0 ? '' : 'Nenhuma notícia encontrada para: ' + q,
    items
  });
}
