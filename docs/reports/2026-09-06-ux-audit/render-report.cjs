#!/usr/bin/env node
'use strict';

// Generates the offline reading edition of report.md; report.md remains the source.
// Usage: node docs/reports/2026-09-06-ux-audit/render-report.cjs [input.md] [output.html]
// An existing marked package can be supplied through REPORT_NODE_MODULES.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const inputPath = path.resolve(process.argv[2] || path.join(__dirname, 'report.md'));
const outputPath = path.resolve(process.argv[3] || path.join(__dirname, 'report.html'));
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function loadMarked() {
  const roots = [
    process.env.REPORT_NODE_MODULES,
    path.join(process.cwd(), 'node_modules'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules')
  ].filter(Boolean);
  for (const root of roots) {
    const modulePath = path.join(root, 'marked', 'lib', 'marked.esm.js');
    if (fs.existsSync(modulePath)) return import(pathToFileURL(modulePath).href);
  }
  throw new Error('기존 marked 패키지를 찾지 못했습니다. REPORT_NODE_MODULES에 패키지 폴더의 상위 경로를 지정하세요.');
}

function prepareArticle(markup) {
  const dom = new JSDOM('<!doctype html><html><body><article>' + markup + '</article></body></html>');
  const document = dom.window.document;
  const article = document.querySelector('article');
  const title = article.querySelector('h1')?.textContent || 'BAEFRAME 사용자 경험 검토 보고서';
  article.querySelector('h1')?.remove();
  const seen = new Set();
  for (const heading of article.querySelectorAll('h2,h3,h4')) {
    const issueId = heading.textContent.match(/^\s*(I\d{2,})\b/i)?.[1].toLowerCase();
    const seed = issueId || heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
    let id = seed;
    let suffix = 2;
    while (seen.has(id)) id = seed + '-' + suffix++;
    seen.add(id);
    heading.id = id;
  }

  // Preserve every source node and its order while making issue bodies collapsible.
  for (const heading of [...article.querySelectorAll('h3')]) {
    if (!/^\s*I\d{2,}\b/i.test(heading.textContent)) continue;
    const details = document.createElement('details');
    details.className = 'issue';
    details.open = true;
    details.dataset.issue = heading.textContent.match(/^\s*(I\d{2,})\b/i)[1];
    const summary = document.createElement('summary');
    const body = document.createElement('div');
    body.className = 'issue-body';
    heading.before(details);
    let next = heading.nextSibling;
    summary.append(heading);
    details.append(summary, body);
    while (next && !(next.nodeType === 1 && /^H[123]$/.test(next.tagName))) {
      const following = next.nextSibling;
      body.append(next);
      next = following;
    }
  }

  for (const table of article.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '표, 가로로 스크롤할 수 있습니다');
    table.before(wrapper);
    wrapper.append(table);
    for (const th of table.querySelectorAll('thead th')) th.setAttribute('scope', 'col');
  }
  for (const image of article.querySelectorAll('img')) {
    image.loading = 'lazy';
    image.decoding = 'async';
    if (!image.closest('a')) {
      const anchor = document.createElement('a');
      anchor.href = image.getAttribute('src');
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.className = 'image-link';
      anchor.setAttribute('aria-label', (image.alt || '화면 캡처') + ' 원본 크기로 열기, 새 탭');
      image.before(anchor);
      anchor.append(image);
    }
  }
  for (const anchor of article.querySelectorAll('a[href]')) {
    if (/^https?:/i.test(anchor.getAttribute('href'))) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  }

  const toc = [...article.querySelectorAll('h2')].map(heading => ({ id: heading.id, text: heading.textContent }));
  const intro = document.createElement('div');
  intro.className = 'report-intro';
  let section = intro;
  let hasIntro = false;
  const originalNodes = [...article.childNodes];
  article.append(intro);
  for (const node of originalNodes) {
    if (node.nodeType === 1 && node.tagName === 'H2') {
      section = document.createElement('section');
      section.className = 'report-section';
      section.setAttribute('aria-labelledby', node.id);
      article.append(section);
    } else if (section === intro && node.textContent.trim()) {
      hasIntro = true;
    }
    section.append(node);
  }
  if (!hasIntro) intro.remove();
  return { title, content: article.innerHTML, toc, issueCount: article.querySelectorAll('.issue').length };
}

const styles = `
:root{color-scheme:light;--paper:#fff;--ground:#f5f6f8;--ink:#20242b;--muted:#606773;--line:#dce0e5;--yellow:#f2d24b;--link:#2458a1;--focus:#155fd0;--side:252px}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:112px}body{margin:0;background:var(--ground);color:var(--ink);font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif;font-size:16px;line-height:1.85;word-break:keep-all;overflow-wrap:anywhere}button,input{font:inherit}button,a,input,summary{touch-action:manipulation}a{color:var(--link);text-decoration-thickness:1px;text-underline-offset:3px}a:hover{text-decoration-thickness:2px}button{cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid var(--focus);outline-offset:4px}button{border:1px solid #c9ced6;border-radius:6px;background:#fff;color:var(--ink);padding:7px 12px;font-size:13px;font-weight:700;line-height:1.6;white-space:nowrap}button:hover{background:#f1f3f6}button:active{transform:translateY(1px)}[hidden]{display:none!important}.skip{position:fixed;top:-100px;left:16px;z-index:20;padding:8px 14px;background:#fff}.skip:focus{top:12px}.layout{display:grid;grid-template-columns:var(--side) minmax(0,1fr);max-width:1600px;margin:auto;min-height:100vh}
.sidebar{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--line);padding:36px 24px 24px;background:var(--ground);scrollbar-width:thin}.brand{display:flex;align-items:center;gap:11px;color:var(--ink);font-size:19px;font-weight:900;letter-spacing:-.6px;text-decoration:none}.brand-mark{width:21px;height:25px;background:var(--yellow);border-radius:2px;position:relative;flex:none}.brand-mark:after{content:"B";position:absolute;inset:0;text-align:center;font-size:16px;line-height:25px;font-weight:900;letter-spacing:0}.document-label{color:var(--muted);font-size:13px;margin:12px 0 34px}.toc-wrap>summary{font-weight:800;font-size:13px;list-style:none;padding:0 0 13px}.toc-wrap>summary::-webkit-details-marker{display:none}.toc{display:flex;flex-direction:column;gap:5px}.toc a{font-size:13px;line-height:1.6;padding:8px 10px;border-left:3px solid transparent;border-radius:0 5px 5px 0;color:#535b68;text-decoration:none}.toc a:hover{background:#e9edf2;color:var(--ink)}.toc a[aria-current="location"]{border-color:#b99500;background:#fff7d4;color:#25220f;font-weight:800}.sidebar-bottom{font-size:12px;border-top:1px solid var(--line);padding-top:18px;margin-top:28px;color:var(--muted)}.sidebar-bottom a{display:inline-block;margin-right:14px}
.main{min-width:0;background:var(--paper)}.toolbar{position:sticky;top:0;z-index:3;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--paper);border-bottom:1px solid var(--line);padding:14px clamp(22px,4vw,68px)}.search{display:flex;align-items:center;gap:10px;min-width:210px;flex:1}.search label{font-size:13px;line-height:1.5;font-weight:700;white-space:nowrap}.search input{border:1px solid #c9ced6;border-radius:6px;min-width:0;width:100%;height:38px;padding:8px 11px;background:#f9fafb;color:var(--ink);font-size:14px}.search input::placeholder{color:#6e7580}.toolbar-actions{display:flex;gap:6px}.search-status{font-size:12px;color:var(--muted);flex-basis:100%;line-height:1.5}.article-shell{max-width:1160px;padding:48px clamp(22px,4vw,68px) 80px;margin:auto}.report-header{border-bottom:3px solid var(--ink);padding:0 0 27px;margin-bottom:29px}.report-header h1{font-size:clamp(30px,3.3vw,44px);line-height:1.32;letter-spacing:-1.8px;margin:0;max-width:850px}.report-header .accent{height:6px;width:62px;background:var(--yellow);margin:0 0 23px}.report-intro{margin-bottom:34px;color:#4a5260;font-size:14px}.report-intro blockquote{font-size:16px;color:var(--ink)}.report-section{padding-top:25px;margin-top:35px;border-top:1px solid var(--line)}.report-section:first-of-type{border-top:0;margin-top:0;padding-top:0}h2{font-size:25px;letter-spacing:-.7px;line-height:1.5;margin:0 0 22px}h3{font-size:19px;letter-spacing:-.4px;line-height:1.6;margin:30px 0 14px}h4{font-size:16px;line-height:1.65;margin:26px 0 12px}p{margin:14px 0 18px}li{padding-left:3px;margin:6px 0}ul,ol{padding-left:23px;margin:16px 0 22px}li>p{margin:7px 0}strong{font-weight:800;color:#141922}blockquote{margin:22px 0;padding:14px 20px;border-left:4px solid var(--yellow);background:#fffbeb}blockquote p:first-child{margin-top:0}blockquote p:last-child{margin-bottom:0}hr{border:0;border-top:1px solid var(--line);margin:32px 0}code{font-family:Consolas,"SFMono-Regular",monospace;font-size:.86em;background:#eef1f5;border-radius:3px;padding:2px 5px;word-break:break-word}pre{padding:18px 20px;background:#f1f3f6;border:1px solid var(--line);overflow:auto;line-height:1.65;border-radius:6px;font-size:13px}pre code{padding:0;background:transparent;word-break:normal}.table-scroll{width:100%;overflow-x:auto;margin:22px 0 28px;border:1px solid var(--line);border-radius:6px;scrollbar-width:thin}table{border-collapse:collapse;min-width:100%;font-size:14px;line-height:1.75}th,td{vertical-align:top;text-align:left;padding:12px 14px;border-right:1px solid #e3e6ea;border-bottom:1px solid #e3e6ea;min-width:125px}th{background:#eef1f5;font-weight:800;color:#252c36}th:first-child,td:first-child{min-width:105px}td:last-child,th:last-child{border-right:0}tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#fafbfc}td>code{white-space:normal}img{display:block;max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#edf0f3}.image-link{display:block;margin:24px 0;cursor:zoom-in}.image-link:after{content:"클릭하면 원본 화면을 새 탭에서 엽니다";display:block;font-size:12px;color:var(--muted);text-align:right;margin-top:7px}.issue{border:1px solid var(--line);border-radius:7px;margin:20px 0;background:#fff;break-inside:avoid}.issue>summary{list-style:none;position:relative;padding:17px 46px 17px 20px;cursor:pointer;background:#f8f9fb;border-radius:6px}.issue>summary::-webkit-details-marker{display:none}.issue>summary:after{content:"+";position:absolute;right:20px;top:17px;font-size:23px;font-weight:400;line-height:1.4;color:#5f6875}.issue[open]>summary:after{content:"−"}.issue>summary:hover{background:#f0f3f7}.issue>summary h3{display:inline;font-size:18px;margin:0;line-height:1.65}.issue[open]>summary{border-bottom:1px solid var(--line);border-radius:6px 6px 0 0}.issue-body{padding:3px 21px 13px}.issue-body>p:first-child{margin-top:17px}.issue-body>.table-scroll{margin-top:18px}.end-note{margin-top:54px;border-top:1px solid var(--line);padding-top:18px;font-size:12px;color:var(--muted);display:flex;justify-content:space-between;gap:20px}.empty-results{padding:14px 18px;background:#fff7d4;border-left:4px solid #b99500;font-size:14px;margin:20px 0}
@media(min-width:1440px){:root{--side:275px}.sidebar{padding-left:32px;padding-right:28px}}
@media(max-width:1000px){:root{--side:214px}.sidebar{padding:28px 17px}.article-shell{padding-left:30px;padding-right:30px}.toolbar{padding-left:30px;padding-right:30px}.search{flex-basis:100%}.toolbar-actions{margin-left:auto}html{scroll-padding-top:162px}}
@media(max-width:760px){html{scroll-padding-top:158px}.layout{display:block}.sidebar{position:relative;height:auto;padding:18px 22px;border-right:0;border-bottom:1px solid var(--line);overflow:visible}.brand{font-size:17px}.brand-mark{width:17px;height:21px}.brand-mark:after{font-size:13px;line-height:21px}.document-label{margin:5px 0 14px;font-size:12px}.toc-wrap>summary{padding:10px 0 0;cursor:pointer;border-top:1px solid var(--line)}.toc-wrap>summary:after{content:" 펼치기";font-weight:400;color:var(--muted)}.toc-wrap[open]>summary:after{content:" 접기"}.toc{padding-top:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.toc a{font-size:12px}.sidebar-bottom{display:none}.toolbar{padding:10px 20px;gap:7px}.search{gap:8px;min-width:0}.search label{font-size:12px}.search input{font-size:13px}.toolbar button{font-size:12px;padding:5px 9px}.toolbar-actions{margin-left:0}.search-status{flex-basis:100%;flex:none;text-align:left}.article-shell{padding:30px 22px 48px}.report-header{padding-bottom:22px;margin-bottom:22px}.report-header h1{font-size:29px;letter-spacing:-1px}.report-header .accent{margin-bottom:19px;width:45px}body{font-size:15px;line-height:1.9}h2{font-size:22px}h3{font-size:18px}.report-section{margin-top:29px;padding-top:25px}.issue>summary{padding:15px 40px 15px 15px}.issue>summary h3{font-size:16px}.issue>summary:after{right:14px;top:14px}.issue-body{padding:2px 15px 9px}th,td{padding:10px 12px;min-width:145px}.end-note{display:block}.end-note>a{display:inline-block;margin-top:8px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}button:active{transform:none}}
@page{size:A4;margin:16mm 14mm}
@media print{html{scroll-behavior:auto}body{background:#fff;font-size:10pt;line-height:1.7;color:#000;orphans:3;widows:3}.layout{display:block;max-width:none}.sidebar,.toolbar,.skip,.end-note,.empty-results{display:none!important}.main{background:#fff}.article-shell{max-width:none;padding:0}.report-header{padding-bottom:6mm;margin-bottom:6mm}.report-header h1{font-size:25pt}.report-header .accent{margin-bottom:5mm}.report-intro{font-size:9pt}h2{font-size:16pt;break-after:avoid}h3{font-size:12pt;break-after:avoid}h4{font-size:10pt;break-after:avoid}.report-section{margin-top:7mm;padding-top:6mm}.issue,.issue[hidden]{display:block!important;break-inside:auto;border-radius:0;margin:5mm 0}.issue>summary{padding:4mm;background:#f3f4f6!important;cursor:default;break-after:avoid}.issue>summary:after{display:none}.issue>summary h3{font-size:11pt}.issue-body{display:block!important;padding:0 4mm 2mm}.table-scroll{overflow:visible;border-radius:0;margin:4mm 0}table{font-size:8pt;table-layout:fixed;width:100%;min-width:0}th,td,th:first-child,td:first-child{padding:2mm;min-width:0;overflow-wrap:anywhere;word-break:normal}thead{display:table-header-group}tr{break-inside:avoid}img{max-height:145mm;object-fit:contain;break-inside:avoid}.image-link{margin:5mm 0}.image-link:after{display:none}a{color:#000;text-decoration:underline}blockquote{margin:4mm 0;padding:3mm 4mm}pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible;font-size:8pt}p{margin:3mm 0}ul,ol{margin:3mm 0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

const clientScript = `
(() => {
  const issues = [...document.querySelectorAll('.issue')];
  const input = document.getElementById('issue-search');
  const status = document.getElementById('search-status');
  const empty = document.getElementById('empty-results');
  const texts = new Map(issues.map(issue => [issue, issue.textContent.toLocaleLowerCase()]));
  const savedOpen = new Map();
  let searching = false;
  function filterIssues() {
    const words = input.value.trim().toLocaleLowerCase().split(/\\s+/).filter(Boolean);
    if (words.length && !searching) issues.forEach(issue => savedOpen.set(issue, issue.open));
    let count = 0;
    for (const issue of issues) {
      const visible = words.every(word => texts.get(issue).includes(word));
      issue.hidden = !visible;
      if (visible) count++;
      if (words.length && visible) issue.open = true;
      else if (!words.length && searching) issue.open = savedOpen.get(issue) ?? true;
    }
    searching = Boolean(words.length);
    status.textContent = words.length ? count + ' / ' + issues.length + '개 개선 항목 일치' : '개선 항목 ' + issues.length + '개 · 본문 검색은 Ctrl+F';
    empty.hidden = count !== 0 || !words.length;
  }
  input.addEventListener('input', filterIssues);
  input.addEventListener('keydown', event => { if(event.key === 'Escape') { input.value = ''; filterIssues(); } });
  document.getElementById('expand-all').addEventListener('click', () => issues.filter(issue => !issue.hidden).forEach(issue => issue.open = true));
  document.getElementById('collapse-all').addEventListener('click', () => issues.filter(issue => !issue.hidden).forEach(issue => issue.open = false));
  document.getElementById('print-report').addEventListener('click', () => window.print());
  const printState = new Map();
  window.addEventListener('beforeprint', () => { for(const issue of issues) { printState.set(issue, {open: issue.open, hidden: issue.hidden}); issue.open = true; issue.hidden = false; } });
  window.addEventListener('afterprint', () => { for(const [issue, state] of printState) { issue.open = state.open; issue.hidden = state.hidden; } printState.clear(); });
  function revealHash() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    const issue = target?.closest('.issue');
    if (issue) {
      if (issue.hidden) { input.value = ''; filterIssues(); }
      issue.open = true;
      requestAnimationFrame(() => target.scrollIntoView({block:'start'}));
    }
  }
  window.addEventListener('hashchange', revealHash);
  revealHash();
  const toc = document.getElementById('toc-disclosure');
  const mobile = matchMedia('(max-width:760px)');
  const setToc = () => toc.open = !mobile.matches;
  mobile.addEventListener('change', setToc);
  setToc();
  const navLinks = [...document.querySelectorAll('.toc a')];
  navLinks.forEach(link => link.addEventListener('click', () => { if(mobile.matches) toc.open = false; }));
  const sectionHeadings = [...document.querySelectorAll('.report-section>h2')];
  let pendingPosition = false;
  function updateTocPosition() {
    pendingPosition = false;
    const threshold = document.querySelector('.toolbar').getBoundingClientRect().bottom + 35;
    let current = sectionHeadings[0];
    for (const heading of sectionHeadings) {
      if (heading.getBoundingClientRect().top <= threshold) current = heading;
      else break;
    }
    navLinks.forEach(link => { if(link.getAttribute('href') === '#' + current?.id) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
  }
  function scheduleTocPosition() {
    if (!pendingPosition) { pendingPosition = true; requestAnimationFrame(updateTocPosition); }
  }
  window.addEventListener('scroll', scheduleTocPosition, {passive:true});
  window.addEventListener('resize', scheduleTocPosition, {passive:true});
  document.querySelector('article').addEventListener('toggle', scheduleTocPosition, true);
  updateTocPosition();
  filterIssues();
})();
`;

async function main() {
  const { marked } = await loadMarked();
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const sourceSha256 = crypto.createHash('sha256').update(markdown).digest('hex');
  const article = prepareArticle(marked.parse(markdown, { gfm: true, breaks: false }));
  const sourceHref = path.relative(path.dirname(outputPath), inputPath).replace(/\\/g, '/');
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="report-source-sha256" content="${sourceSha256}"><title>${escape(article.title)}</title><style>${styles}</style></head>
<body id="top"><a class="skip" href="#report-content">본문으로 건너뛰기</a><div class="layout">
<aside class="sidebar"><a class="brand" href="#top"><span class="brand-mark" aria-hidden="true"></span>BAEFRAME</a><p class="document-label">사용자 경험 검토 보고서</p><details class="toc-wrap" id="toc-disclosure" open><summary>보고서 목차</summary><nav class="toc" aria-label="보고서 목차">${article.toc.map(item => `<a href="#${escape(item.id)}">${escape(item.text)}</a>`).join('')}</nav></details><div class="sidebar-bottom"><p>화면 캡처를 클릭하면<br>원본 크기로 볼 수 있습니다.</p><a href="${escape(sourceHref)}">원문 Markdown</a><a href="#top">맨 위로</a></div></aside>
<main class="main"><div class="toolbar" aria-label="보고서 읽기 도구"><div class="search"><label for="issue-search">개선 항목 검색</label><input id="issue-search" type="search" placeholder="예: 이어보기, 저장, I01" autocomplete="off" aria-describedby="search-status"></div><div class="toolbar-actions"><button type="button" id="expand-all">모두 펼치기</button><button type="button" id="collapse-all">모두 접기</button><button type="button" id="print-report">인쇄 / PDF</button></div><div class="search-status" id="search-status" role="status" aria-live="polite">개선 항목 ${article.issueCount}개 · 본문 검색은 Ctrl+F</div></div>
<div class="article-shell"><header class="report-header"><div class="accent" aria-hidden="true"></div><h1>${escape(article.title)}</h1></header><p class="empty-results" id="empty-results" hidden>일치하는 개선 항목이 없습니다. 다른 단어로 검색하거나 검색어를 지우면 전체 항목을 볼 수 있습니다.</p><article id="report-content" tabindex="-1">${article.content}</article><footer class="end-note"><span>이 HTML은 같은 폴더의 보고서 원문으로부터 생성되었습니다.</span><a href="#top">맨 위로 돌아가기</a></footer></div></main></div><script>${clientScript}</script></body></html>`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
  const htmlDocument = new JSDOM(html).window.document;
  const missingAnchors = [...htmlDocument.querySelectorAll('a[href^="#"]')].map(anchor => anchor.getAttribute('href').slice(1)).filter(id => id && !htmlDocument.getElementById(id));
  if (missingAnchors.length) throw new Error('존재하지 않는 본문 링크: ' + missingAnchors.join(', '));
  console.log(JSON.stringify({ output: outputPath, sourceSha256, title: article.title, sections: article.toc.length, issues: article.issueCount, bytes: Buffer.byteLength(html), missingAnchors }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
