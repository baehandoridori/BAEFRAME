'use strict';

// 보고서용 완성 화면 시안. 운영 앱이나 IPC를 실행하지 않는다.
const styles = `
.rv-side,.rv-comments{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.rv-side .panel-header,.rv-comments .panel-header{flex-shrink:0}
.rv-panel-title{font-size:13px;font-weight:650;letter-spacing:-.2px}
.rv-count{font-size:11px;color:#b4bdc9;font-variant-numeric:tabular-nums}
.rv-side-pad{padding:12px}.rv-side.rv-drawing .rv-side-pad{padding:8px 12px}.rv-side.rv-drawing .rv-folder.sub{display:none}.rv-side.rv-drawing .rv-section{padding-top:10px;padding-bottom:5px}.rv-side.rv-drawing .rv-folder{min-height:29px}
.rv-folder{display:flex;align-items:center;gap:8px;min-height:32px;font-size:12px;color:#b8c0cc;padding:0 10px}
.rv-folder.current{color:#ead184;background:#2b2a24;border-radius:5px}
.rv-folder.sub{padding-left:28px;color:#9aa5b4}
.rv-folder .spacer{flex:1}
.rv-section{padding:16px 12px 8px;display:flex;align-items:center;justify-content:space-between}
.rv-section .section-label{margin:0;font-size:10px;letter-spacing:.7px;color:#8d98a7}
.rv-library{padding:0 8px;display:grid;gap:5px}
.rv-media{margin:0;display:flex;align-items:center;gap:9px;padding:8px 6px;min-height:65px;border:1px solid transparent;border-radius:5px}
.rv-media.selected{background:#2e3033;border-color:#706447}
.rv-media .media-thumb{width:66px;height:42px;border-radius:3px;overflow:hidden;flex-shrink:0;position:relative;background:#343c45}
.rv-media img{width:100%;height:100%;object-fit:cover}
.rv-media:nth-child(2) img{object-position:64% 50%;filter:brightness(.86)}
.rv-media:nth-child(3) img{object-position:35% 50%;filter:brightness(1.06)}
.rv-media .media-info{min-width:0;flex:1}
.rv-media strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:550;color:#dbe1e8}
.rv-media small{display:flex;justify-content:space-between;gap:4px;flex-wrap:wrap;line-height:1.45;font-size:10px;color:#98a4b3;margin-top:6px;white-space:nowrap}
.rv-media-current{position:absolute;left:4px;bottom:4px;background:#12171ddd;color:#eee2b0;font-size:8px;padding:2px 4px;border-radius:2px}
.rv-folder-foot{padding:13px 12px;font-size:10px;line-height:1.7;color:#98a4b3;border-top:1px solid #333a44;margin-top:auto}
.rv-folder-foot strong{color:#c5ced9;font-weight:500}
.rv-layer-list{margin:0 8px;border:1px solid #343b45;border-radius:5px;overflow:hidden}
.rv-layer{display:flex;align-items:center;gap:7px;padding:11px 8px;font-size:11px;color:#aeb8c5;border-bottom:1px solid #343b45}
.rv-layer:last-child{border:0}
.rv-layer.selected{color:#e5d18b;background:#333127;box-shadow:inset 2px 0 #dfc478}
.rv-layer svg{flex-shrink:0}.rv-layer .spacer{flex:1}
.rv-layer small{font-size:10px;color:#929daf}
.rv-layer-note{padding:9px 12px;color:#a6b0be;font-size:10px;line-height:1.7}
.rv-viewer{display:flex;flex-direction:column;min-height:0;overflow:hidden;background:#161b22}
.rv-viewer .toolbar{display:flex;gap:8px;padding:0 14px;flex-shrink:0;border-bottom:1px solid #343b45}
.rv-viewer .toolbar .spacer{flex:1}
.rv-view-label{color:#d4dbe4;font-size:12px;font-weight:550;display:flex;align-items:center;gap:8px}
.rv-tab{padding:6px 9px;color:#a5afbd;border-radius:4px;font-size:11px;display:flex;align-items:center;gap:6px}
.rv-tab.current{background:#303641;color:#e8edf3}
.rv-stage{display:flex;align-items:center;justify-content:center;min-height:0;padding:23px 30px;isolation:isolate;background:#14191f}
.rv-image-wrap{height:100%;width:100%;position:relative;min-height:0}
.rv-picture{width:100%;height:100%;object-fit:contain;display:block}
.rv-image-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.rv-context{display:flex;align-items:center;gap:8px;height:40px;min-height:40px;padding:0 14px;flex-shrink:0;background:#252c35;border-bottom:1px solid #3b424c;font-size:11px;color:#bdc7d3}
.rv-context strong{color:#edda9b;font-weight:550}
.rv-context .spacer{flex:1}
.rv-context-divider{height:16px;width:1px;background:#454c57;margin:0 3px}
.rv-context kbd,.rv-viewer kbd{border:1px solid #4b535e;border-radius:3px;min-width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;font:10px 'Segoe UI',sans-serif;color:#c7cfd9;margin-left:5px}
.rv-tool{width:29px;height:27px;border:1px solid transparent;border-radius:4px;background:transparent;color:#b9c3d0;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.rv-tool.active{border-color:#8e7b45;color:#f2d88d;background:#4b422b}
.rv-transport{display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-top:1px solid #343b45;gap:12px;flex-shrink:0;background:#20262f}
.rv-transport-group{display:flex;align-items:center;gap:9px;font-size:11px;color:#a3afbe}
.rv-time{color:#e9edf2;font-variant-numeric:tabular-nums;letter-spacing:.3px;font-size:12px;font-weight:600}
.rv-time.current{color:#e9d391}.rv-transport .icon-button{width:26px;height:26px}
.rv-time-divider{color:#5c6776}.rv-small-pill{font-size:10px;color:#b8c2cf;padding:3px 6px;border:1px solid #454e5a;border-radius:3px}
.rv-comments{background:#232a33}
.rv-comments .panel-header{display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #38414c}
.rv-comments .panel-header .spacer{flex:1}
.rv-comment-filter{height:42px;display:flex;align-items:center;padding:0 13px;gap:6px;border-bottom:1px solid #343c47;flex-shrink:0}
.rv-comment-filter .btn{font-size:10px;min-height:25px;padding:4px 7px}
.rv-comment-filter .spacer{flex:1}
.rv-comment-list{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;padding:10px;display:flex;flex-direction:column;gap:9px}
.rv-comment{padding:13px 12px;border:1px solid #3d4652;border-radius:6px;background:#272f3a;flex-shrink:0}
.rv-comment.selected{border-color:#a68c4d;background:#302f29;box-shadow:inset 3px 0 #d6bb70}
.rv-comment-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.rv-comment .avatar{width:27px;height:27px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;background:#525969;color:#f0f1f4;font-weight:600}
.rv-comment .avatar.warm{background:#695750;color:#f5e5cc}.rv-comment .avatar.blue{background:#3e5a69;color:#d6eef2}
.rv-author{font-size:11px;color:#e2e7ed;font-weight:600;line-height:1.5}.rv-author small{font-size:10px;color:#a6b0bc;font-weight:400;margin-left:6px}
.rv-comment-date{font-size:10px;color:#a5b0be;margin-top:1px}
.rv-comment-head .spacer{flex:1}
.rv-comment .time-range{display:flex;align-items:center;justify-content:space-between;color:#e2cd8c;font-size:10px;letter-spacing:.1px;font-variant-numeric:tabular-nums;margin:0 0 9px;padding:5px 7px;background:#1a202799;border-radius:3px}
.rv-comment p{font-size:12px;line-height:1.7;margin:0;color:#d6dde6;word-break:keep-all}
.rv-comment-actions{display:flex;align-items:center;gap:10px;margin-top:11px;color:#adbac7;font-size:10px}
.rv-comment-actions .spacer{flex:1}
.rv-comment-actions button{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:2px 0;color:inherit;font:inherit}
.rv-resolved{color:#93c6b3!important}
.rv-reply-note{font-size:10px;color:#b8c5d1;border-left:2px solid #677587;padding-left:8px;margin-top:9px;line-height:1.6}
.rv-composer{flex-shrink:0;border-top:1px solid #3b444f;padding:12px 14px;background:#202731}
.rv-compose-context{font-size:10px;color:#bfc9d5;display:flex;justify-content:space-between;margin-bottom:9px}
.rv-compose-context strong{color:#e4ce8c;font-weight:500}
.rv-compose-input{min-height:58px;border:1px solid #505b6a;background:#171e27;border-radius:5px;padding:10px;font-size:11px;color:#9eadbc;line-height:1.6}
.rv-compose-actions{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:10px;color:#9ca9b9}.rv-compose-actions .spacer{flex:1}
.rv-compose-actions .btn{height:28px;font-size:11px;gap:6px}
.rv-properties{border-bottom:1px solid #46505e;padding:11px 14px;background:#252e39;flex-shrink:0}
.rv-property-title{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#e2ce91;font-weight:600;margin-bottom:10px}
.rv-property-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rv-property-label{font-size:10px;color:#aab6c5;display:flex;align-items:center;gap:6px}
.rv-property-label .field{margin-left:auto;background:#18212b;border:1px solid #465463;border-radius:3px;padding:5px 7px;color:#e0e7ef;font-size:11px;min-width:53px;text-align:right}
.rv-color-chip{width:11px;height:11px;display:inline-block;background:#f07866;border-radius:3px;margin-right:5px;vertical-align:-1px}
.rv-property-foot{font-size:10px;color:#aebccd;margin-top:9px;display:flex;align-items:center;gap:6px}
.rv-timeline{display:flex;flex-direction:column;min-height:0;overflow:hidden;background:#222933;position:relative}
.rv-timeline .panel-header{display:flex;align-items:center;padding:0 13px;gap:9px;flex-shrink:0;border-bottom:1px solid #3b4450}
.rv-timeline .panel-header .spacer{flex:1}.rv-timeline .panel-header .btn{font-size:10px;min-height:25px;padding:4px 7px}
.rv-track-table{flex:1;min-height:0;position:relative}
.rv-timeline .track-row{display:grid;grid-template-columns:124px minmax(0,1fr);position:relative;min-height:40px;border-bottom:1px solid #323d49}
.rv-timeline .track-label{width:auto;display:flex;align-items:center;gap:7px;padding:0 12px;font-size:10px;background:#252e39;color:#b5c1ce;border-right:1px solid #45505d;position:relative;z-index:2}
.rv-timeline .track-label strong{font-size:10px;font-weight:500;color:#dbc78b}
.rv-timeline .track-content{position:relative;min-width:0;background-image:linear-gradient(90deg,#40506340 1px,transparent 1px);background-size:16.6667% 100%;background-color:#1d2631}
.rv-timeline .ruler{min-height:28px;height:28px}
.rv-timeline .ruler .track-label{font-size:9px;color:#91a1b3}
.rv-axis span{position:static;transform:none}.rv-axis span:after{display:none}.rv-library-tabs{display:flex;gap:4px;padding:10px 10px 0}.rv-library-tabs .btn{flex:1;font-size:10px;padding:0 6px}.rv-axis{display:flex;justify-content:space-between;align-items:center;padding:0 6px;height:28px;color:#96a7bb;font-size:9px;font-variant-numeric:tabular-nums}
.rv-video-clip{position:absolute;inset:7px 6px;height:27px;border-radius:3px;background:#334b5e;border:1px solid #587186;display:flex;align-items:center;gap:8px;padding:0 8px;color:#d0e0ee;font-size:10px;overflow:hidden}
.rv-video-clip img{width:30px;height:20px;object-fit:cover;border-radius:2px}.rv-video-clip .spacer{flex:1}
.rv-timeline .rv-comments-track{height:50px}
.rv-range{position:absolute;top:10px;height:28px;display:flex;align-items:center;gap:5px;padding:0 7px;border-radius:3px;background:#345563;border:1px solid #608795;color:#d3e7eb;font-size:9px;white-space:nowrap;overflow:hidden}
.rv-range.selected{background:#685d36;border-color:#d4b86b;color:#f4e3b1;min-width:0}
.rv-range.resolved{background:#304c46;border-color:#567769;color:#b9d6c9}
.rv-timeline .drawing-span{position:absolute;top:10px;height:22px;min-width:0;display:flex;align-items:center;background:#574a37;border:1px solid #bca270;color:#efddb3;border-radius:3px;padding:0 5px 0 15px;font-size:9px;white-space:nowrap}
.rv-timeline .key{border-radius:50%;position:absolute;left:4px;top:7px;width:6px;height:6px;background:#f1d88c;transform:none}
.rv-timeline .empty-key{position:absolute;top:15px;width:8px;height:8px;border-radius:50%;border:1px solid #8d9db0;transform:none;background:#253140}
.rv-timeline .playhead{position:absolute;top:0;bottom:0;left:calc(124px + (100% - 124px)*.277778);width:1px;background:#eed18a;pointer-events:none;z-index:5}
.rv-timeline .playhead::before{clip-path:none;content:'80';position:absolute;top:0;left:-11px;background:#ecd08a;color:#262d35;border-radius:0 0 3px 3px;padding:3px 4px;font-size:9px;line-height:12px;min-width:14px;text-align:center}
.rv-timeline .footer-line{height:30px;min-height:30px;display:flex;align-items:center;padding:0 13px;gap:12px;color:#9eafc2;font-size:10px;border-top:1px solid #3b4653;background:#252e39}
.rv-timeline .footer-line .spacer{flex:1}.rv-timeline .footer-line strong{font-weight:500;color:#dece9e}
.rv-overview{height:23px;margin:8px 12px 6px 136px;border:1px solid #506071;border-radius:3px;background:linear-gradient(90deg,#3b5363 0%,#3b5363 25%,#8b7644 25%,#8b7644 29.1667%,#3b5363 29.1667%,#3b5363 100%);opacity:.85;position:relative}
.rv-overview:after{content:'';position:absolute;inset:0;border:1px solid #b6c0cd;border-radius:2px}.rv-overview-label{position:absolute;left:12px;bottom:41px;font-size:9px;color:#9babbd}
.rv-drawing .rv-comment-list{gap:8px}.rv-drawing .rv-comment{padding:11px}.rv-drawing .rv-comment p{font-size:11px;line-height:1.65}
.rv-drawing .rv-comments .rv-comment-filter{height:36px}.rv-drawing .rv-comments .rv-comment-head{margin-bottom:8px}
`;

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function render({ icon, shot = 'animation-shot.png' }, drawing) {
  const i = (name, size = 15) => icon(name, size);
  const image = escapeAttribute(shot);
  const tool = (name, label, active = false) => `<button type="button" class="rv-tool${active ? ' active' : ''}" title="${label}" aria-label="${label}"${active ? ' aria-pressed="true"' : ''}>${i(name)}</button>`;
  const media = (name, sub, selected, index) => `<div class="media-item rv-media${selected ? ' selected' : ''}"><div class="media-thumb"><img src="${image}" alt="바닷가 애니메이션 ${name}">${selected ? '<span class="rv-media-current">검토 중</span>' : ''}</div><div class="media-info"><strong>${name}</strong><small><span>${sub}</span><span>${index}</span></small></div></div>`;
  const comments = `<article class="comment selected rv-comment"><div class="rv-comment-head"><span class="avatar warm">서윤</span><div><div class="rv-author">김서윤<small>연출</small></div><div class="rv-comment-date">오늘 10:42</div></div><span class="spacer"></span><button class="icon-button" title="댓글 메뉴" aria-label="댓글 메뉴">${i('more')}</button></div><div class="time-range"><span>00:00:03:00 — 00:00:03:12</span><span>12F</span></div><p>손이 올라오는 시작을 3프레임 늦춰주세요. 손끝은 얼굴보다 조금 낮게, 시선은 상대를 향하면 좋겠습니다.</p><div class="rv-comment-actions"><button>${i('message', 12)}답글 2</button><button>${i('pen', 12)}그림 2</button><span class="spacer"></span><button>${i('check', 12)}해결하기</button></div>${drawing ? '' : '<div class="rv-reply-note">이준호 · 손끝 높이와 시선 방향을 그림으로 표시했습니다.</div>'}</article>
  <article class="comment rv-comment"><div class="rv-comment-head"><span class="avatar blue">도현</span><div><div class="rv-author">박도현<small>애니메이션</small></div><div class="rv-comment-date">오늘 09:58</div></div><span class="spacer"></span><span class="rv-resolved">${i('check', 14)}</span></div><div class="time-range"><span>00:00:05:00 — 00:00:06:00</span><span>24F</span></div><p>발이 멈춘 뒤 상체가 한 박자 더 따라오는 느낌이 좋습니다. 이 타이밍은 유지해주세요.</p><div class="rv-comment-actions"><button>${i('message', 12)}답글 1</button><span class="spacer"></span><span class="rv-resolved">해결됨</span></div></article>
  ${`<article class="comment rv-comment"><div class="rv-comment-head"><span class="avatar warm">서윤</span><div><div class="rv-author">김서윤<small>연출</small></div><div class="rv-comment-date">오늘 09:46</div></div><span class="spacer"></span><button class="icon-button" title="댓글 메뉴" aria-label="댓글 메뉴">${i('more')}</button></div><div class="time-range"><span>00:00:08:00 — 00:00:09:00</span><span>24F</span></div><p>마지막 인사 포즈는 여기서 잠깐 유지해주세요. 눈을 마주친 다음 팔이 내려오면 자연스럽겠습니다.</p><div class="rv-comment-actions"><button>${i('message', 12)}답글</button><span class="spacer"></span><button>${i('check', 12)}해결하기</button></div></article>`}`;

  const left = `<aside class="side-left rv-side${drawing ? ' rv-drawing' : ''}"><div class="panel-header"><span class="rv-panel-title">${drawing ? '영상 · 레이어' : '영상 목록'}</span><span class="spacer"></span><button class="icon-button" title="영상 추가" aria-label="영상 추가">${i('plus')}</button></div><div class="rv-library-tabs"><button class="btn active">재생목록</button><button class="btn">컷 묶음</button></div><div class="rv-side-pad"><div class="rv-folder">${i('folder')}바닷가에서의 인사<span class="spacer"></span>${i('chevron-down', 12)}</div><div class="rv-folder sub">${i('folder', 13)}애니메이션 검토</div><div class="rv-folder current">${i('chevron-down', 12)}오늘 확인할 영상<span class="spacer"></span><span class="rv-count">3</span></div></div><div class="rv-section"><span class="section-label">${drawing ? '현재 영상' : '검토 목록'}</span><button class="icon-button" title="영상 검색" aria-label="영상 검색">${i('search', 13)}</button></div><div class="rv-library">${media('034 · 손 흔들기', '버전 12 · 12초', true, '2 미해결')}${drawing ? '' : media('035 · 시선 따라가기', '버전 08 · 8초', false, '완료') + media('036 · 마지막 인사', '버전 03 · 10초', false, '1 미해결')}</div>${drawing ? `<div class="rv-section"><span class="section-label">드로잉 레이어</span><button class="icon-button" title="레이어 추가" aria-label="레이어 추가">${i('plus', 13)}</button></div><div class="rv-layer-list"><div class="rv-layer selected">${i('eye', 13)}포즈 수정<span class="spacer"></span><small>100%</small></div><div class="rv-layer">${i('eye', 13)}동선 참고<span class="spacer"></span>${i('lock', 12)}</div><div class="rv-layer">${i('eye', 13)}원본 영상<span class="spacer"></span>${i('lock', 12)}</div></div><div class="rv-layer-note">현재 레이어 · 포즈 수정<br>노출 72–84F · 12프레임 유지</div>` : `<div class="rv-section"><span class="section-label">폴더</span></div><div class="rv-folder">${i('folder', 14)}이전 버전<span class="spacer"></span><span class="rv-count">8</span></div><div class="rv-folder">${i('folder', 14)}검토 완료<span class="spacer"></span><span class="rv-count">12</span></div>`}<div class="rv-folder-foot"><strong>바닷가에서의 인사 / 애니메이션</strong><br>이 기기의 폴더 · 영상 3개<div class="row" style="margin-top:8px;color:#c3cdd8;gap:6px">${i('folder', 12)}폴더 열기</div></div></aside>`;

  const overlay = drawing ? `<svg class="rv-image-overlay" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" aria-label="포즈 수정 레이어의 두 획 선택"><g fill="none" stroke="#f17968" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M900 261 Q954 198 1002 248"/><path d="M916 302 Q962 324 998 299"/></g><g fill="none" stroke="#e4ce8d" stroke-width="2" stroke-dasharray="5 5"><rect x="883" y="199" width="144" height="145" rx="2"/></g><g fill="#232c37" stroke="#e8d197" stroke-width="2"><rect x="879" y="195" width="8" height="8"/><rect x="1023" y="195" width="8" height="8"/><rect x="879" y="340" width="8" height="8"/><rect x="1023" y="340" width="8" height="8"/></g></svg>` : '';
  const viewer = `<section class="viewer rv-viewer${drawing ? ' rv-drawing' : ''}"><div class="toolbar"><span class="rv-tab${drawing ? '' : ' current'}">${i('play', 13)}원본 보기</span><span class="rv-tab${drawing ? ' current' : ''}">${i('pen', 13)}드로잉 리뷰</span><span class="spacer"></span><span class="muted tiny">1920 × 1080 · 24fps</span><span class="rv-tab">레이어 합성</span><span class="rv-tab">구간 반복</span><span class="rv-tab">맞춤 ${i('chevron-down', 12)}</span>${tool('expand', '미리보기 전체 화면')}</div>${drawing ? `<div class="rv-context">${tool('mouse', '선택 도구 V', true)}${tool('pen', '그리기 도구 B')}${tool('eraser', '지우개')}${tool('hand', '화면 이동 H')}<span class="rv-context-divider"></span><strong>선택 <kbd>V</kbd></strong><span>획 전체</span>${i('chevron-down', 11)}<span class="rv-context-divider"></span><span>포즈 수정</span><span class="spacer"></span><span>현재 <strong>80F</strong></span><span>노출 <strong>72–84F</strong></span><span class="rv-small-pill">2개 선택</span></div>` : `<div class="rv-context"><strong>댓글 검토</strong><span class="rv-context-divider"></span>${tool('arrow-left', '이전 댓글')}${tool('arrow-right', '다음 댓글')}<span>1 / 3</span><span class="rv-context-divider"></span><span>김서윤 · 손끝과 시선</span><span class="spacer"></span><span>현재 <strong>80F</strong></span><span>댓글 구간 <strong>72–84F</strong></span><span class="rv-small-pill">12F</span></div>`}<div class="viewer-stage rv-stage"><div class="rv-image-wrap"><img class="rv-picture" src="${image}" alt="바닷가에서 손을 흔드는 캐릭터의 애니메이션 원본">${overlay}</div></div><div class="transport rv-transport"><div class="rv-transport-group"><span class="rv-time current">00:00:03:08</span><span class="rv-time-divider">/</span><span class="rv-time">00:00:12:00</span><span class="rv-small-pill">80 / 288F</span></div><div class="rv-transport-group">${tool('skip-back', '처음으로')}${tool('arrow-left', '이전 프레임')}${tool('play', '재생')}${tool('arrow-right', '다음 프레임')}${tool('skip-forward', '끝으로')}</div><div class="rv-transport-group">${tool('volume', '음량')}<span>100%</span><span class="rv-context-divider"></span>${tool('message', '현재 프레임에 댓글')}<span>댓글 <kbd>C</kbd></span></div></div></section>`;

  const right = `<aside class="side-right rv-comments${drawing ? ' rv-drawing' : ''}">${drawing ? `<div class="panel-header"><span class="rv-panel-title">선택한 그림</span><span class="spacer"></span><span class="rv-count">2개 획</span></div><div class="rv-properties"><div class="rv-property-title"><span>포즈 수정</span><span class="rv-count">72–84F · 12F</span></div><div class="rv-property-grid"><div class="rv-property-label">색상<span class="field"><span class="rv-color-chip"></span>산호</span></div><div class="rv-property-label">두께<span class="field">4 px</span></div><div class="rv-property-label">불투명도<span class="field">100 %</span></div><div class="rv-property-label">범위<span class="field">획 전체</span></div></div><div class="rv-property-foot">${i('check', 12)}선택한 2개 획에만 적용됩니다</div></div>` : ''}<div class="panel-header"><span class="rv-panel-title">댓글</span><span class="badge">2 미해결</span><span class="spacer"></span><span class="rv-count">전체 3</span><button class="icon-button" title="댓글 검색" aria-label="댓글 검색">${i('search', 14)}</button></div><div class="rv-comment-filter"><button class="btn active">전체</button><button class="btn">미해결</button><button class="btn">해결됨</button><span class="spacer"></span><button class="icon-button" title="작성자로 필터링" aria-label="작성자로 필터링">${i('filter', 14)}</button></div><div class="rv-comment-list">${comments}</div><div class="composer rv-composer"><div class="rv-compose-context"><span>새 댓글 · 현재 프레임</span><strong>00:00:03:08 · 80F</strong></div><div class="rv-compose-input">이 프레임에 대한 피드백을 입력하세요.</div><div class="rv-compose-actions"><button class="icon-button" title="이미지 첨부" aria-label="이미지 첨부">${i('plus', 14)}</button><span>구간 지정</span><span class="spacer"></span><button class="btn primary">${i('send', 13)}댓글 남기기</button></div></div></aside>`;

  const timeline = `<section class="timeline rv-timeline"><div class="panel-header"><span class="rv-panel-title">리뷰 타임라인</span><span class="badge">24fps</span><span class="spacer"></span><button class="btn active">${i('message', 12)}댓글 구간</button><button class="btn">${i('pen', 12)}그림 노출</button><span class="rv-context-divider"></span>${tool('zoom-out', '타임라인 축소')}<span class="rv-count">전체 12초</span>${tool('zoom-in', '타임라인 확대')}</div><div class="rv-track-table"><div class="track-row ruler"><div class="track-label">트랙 · 프레임</div><div class="track-content rv-axis"><span>00:00</span><span>00:02</span><span>00:04</span><span>00:06</span><span>00:08</span><span>00:10</span><span>00:12</span></div></div><div class="track-row"><div class="track-label">${i('lock', 12)}원본 영상</div><div class="track-content"><div class="clip rv-video-clip"><img src="${image}" alt="원본 영상 축소판"><span>034 · 손 흔들기 · 버전 12</span><span class="spacer"></span><span>288F</span></div></div></div><div class="track-row rv-comments-track"><div class="track-label">${i('message', 13)}댓글 <span class="rv-count">3</span></div><div class="track-content"><div class="rv-range selected" style="left:25%;width:4.1667%" title="손끝과 시선 · 72–84F">12F</div><div class="rv-range resolved" style="left:41.6667%;width:8.3333%" title="상체 타이밍 · 120–144F">${i('check', 11)}24F</div><div class="rv-range" style="left:66.6667%;width:8.3333%" title="마지막 인사 · 192–216F">${i('message', 11)}24F</div></div></div><div class="track-row"><div class="track-label">${i('eye', 13)}<strong>포즈 수정</strong></div><div class="track-content"><div class="drawing-span" style="left:25%;width:4.1667%" title="그림 2개 · 72–84F"><span class="key"></span>12F</div><span class="empty-key" style="left:29.1667%" title="84F부터 빈 프레임"></span></div></div><div class="playhead" aria-label="현재 프레임80"></div></div><span class="rv-overview-label">전체 구간</span><div class="rv-overview"></div><div class="footer-line"><span>${i('mouse', 11)} 프레임 선택</span><span>${i('hand', 11)} 가운데 버튼으로 이동</span><span class="spacer"></span><strong>선택 구간 72–84F</strong><span>12프레임 · 0.5초</span></div></section>`;

  return {
    mode: 'BAEFRAME',
    title: drawing ? '드로잉 리뷰' : '영상 리뷰',
    subtitle: '바닷가에서의 인사 / 애니메이션 검토',
    documentName: '바닷가_손흔들기_034_v12.mp4',
    dirty: false,
    headerAction: '링크 복사',
    body: left + viewer + timeline + right,
    status: '이 기기에 저장됨 · 14:32 · 바닷가_손흔들기_034_v12.bframe',
    styles
  };
}

module.exports = {
  review: options => render(options, false),
  reviewDrawing: options => render(options, true)
};
