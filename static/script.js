'use strict';

// ── 공연장 코드 매핑 ──────────────────────────────────────
const VENUE_CODES = {
  FC000001: '예술의전당',
  FC000020: '세종문화회관',
  FC003045: 'LG아트센터 서울',
  FC000127: '고양아람누리',
  FC001513: '롯데콘서트홀',
  FC000788: '마포아트센터 아트홀맥',
  FC001556: '금호아트홀 연세',
  FC003150: '부천아트센터 콘서트홀',
  FC001873: '아트센터인천',
};

// ── 독주회 분류 기준 ─────────────────────────────────────
const SOLO_KEYWORDS = ['독주회', '리사이틀', '독창회'];
// "이름(2~4자) + 악기/분야" 패턴 → 개인 공연으로 분류
const SOLO_NAME_PATTERN = /^[가-힣]{2,4}\s+(피아노|바이올린|첼로|비올라|플루트|클라리넷|오보에|하프|기타|성악|소프라노|테너|바리톤|메조소프라노|알토|트럼펫|호른|타악)/;

function isSolo(perf) {
  return SOLO_KEYWORDS.some(kw => perf.name.includes(kw)) ||
         SOLO_NAME_PATTERN.test(perf.name);
}

// ── 상태 ──────────────────────────────────────────────────
let allPerformances = [];
let activeVenue = 'all';
let activeGenre = 'all';
let activeTab   = 'main';
let activeView  = localStorage.getItem('view') || 'card';

// ── 날짜 포맷 ─────────────────────────────────────────────
function formatDateRange(start, end) {
  if (!start) return '-';
  if (!end || start === end) return start;
  return `${start} ~ ${end}`;
}

// ── 공연 상태 ─────────────────────────────────────────────
function getStatusInfo(status) {
  if (status === '공연중')   return { label: '공연중',   badgeClass: 'badge-active' };
  if (status === '공연예정') return { label: '공연예정', badgeClass: 'badge-upcoming' };
  return { label: status || '', badgeClass: 'badge-ended' };
}

// ── 장르 단축명 ───────────────────────────────────────────
function genreShort(genre) {
  const map = {
    '서양음악(클래식)':    '클래식',
    '한국음악(국악)':     '국악',
    '무용(서양/한국무용)': '무용',
    '대중음악':           '대중음악',
  };
  return map[genre] || genre;
}

// ── XSS 방어 ─────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 포스터 HTML (카드용) ──────────────────────────────────
function posterCardHtml(poster) {
  if (poster && poster.trim()) {
    return `<img class="card-img" src="${escHtml(poster)}" alt="포스터"
              loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="card-no-img" style="display:none">🎵<small>NO IMAGE</small></div>`;
  }
  return `<div class="card-no-img">🎵<small>NO IMAGE</small></div>`;
}

// ── 포스터 HTML (모달용) ──────────────────────────────────
function posterModalHtml(poster) {
  if (poster && poster.trim()) {
    return `<img src="${escHtml(poster)}" alt="포스터"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="modal-poster-ph" style="display:none">🎵</div>`;
  }
  return `<div class="modal-poster-ph">🎵</div>`;
}

// ── 가격 파싱 (원, 기준으로 분리) ────────────────────────
function parsePriceItems(priceStr) {
  if (!priceStr) return [];
  // "R석 100,000원, S석 80,000원" → "원," 경계로 분리하여 쉼표 혼동 방지
  return priceStr
    .split(/원\s*,\s*/)
    .map((s, i, arr) => {
      const t = s.trim();
      if (!t) return '';
      return i < arr.length - 1 ? t + '원' : t;
    })
    .filter(Boolean);
}

// ── 필터 ─────────────────────────────────────────────────
function filtered() {
  let result = allPerformances;
  if (activeVenue !== 'all') result = result.filter(p => p.venueCode === activeVenue);
  if (activeGenre !== 'all') result = result.filter(p => p.genre === activeGenre);
  if (activeTab === 'main')  result = result.filter(p => !isSolo(p));
  if (activeTab === 'solo')  result = result.filter(p => isSolo(p));
  return result;
}

// ── 그리드/리스트 렌더 ────────────────────────────────────
function renderGrid(performances) {
  const grid = document.getElementById('grid');
  const bar  = document.getElementById('resultsBar');

  if (performances.length === 0) {
    bar.innerHTML = '';
    grid.innerHTML = `
      <div class="state-box">
        <div class="state-icon">🔍</div>
        <div class="state-title">공연 정보가 없습니다</div>
        <div class="state-msg">선택한 조건에 맞는 공연이 없습니다.</div>
      </div>`;
    return;
  }

  bar.innerHTML = `
    <div class="results-count">총 <strong>${performances.length}개</strong>의 공연</div>
    <div class="date-range">오늘 이후 10개월 기준</div>`;

  if (activeView === 'list') {
    renderListView(performances, grid);
  } else {
    renderCardView(performances, grid);
  }
}

// ── 카드뷰 ────────────────────────────────────────────────
function renderCardView(performances, grid) {
  grid.className = 'grid';
  grid.innerHTML = performances.map(p => {
    const status = getStatusInfo(p.status);
    return `
      <article class="card" data-id="${escHtml(p.id)}" tabindex="0" role="button" aria-label="${escHtml(p.name)}">
        <div class="card-img-wrap">
          ${posterCardHtml(p.poster)}
          ${status.label ? `<span class="card-status-badge ${status.badgeClass}">${status.label}</span>` : ''}
        </div>
        <div class="card-body">
          <div class="card-venue-name">${escHtml(p.venue || VENUE_CODES[p.venueCode] || '')}</div>
          <h3 class="card-title">${escHtml(p.name || '제목 없음')}</h3>
          <div class="card-date">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            ${escHtml(formatDateRange(p.startDate, p.endDate))}
          </div>
        </div>
      </article>`;
  }).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(card.dataset.id); }
    });
  });
}

// ── 리스트뷰 ──────────────────────────────────────────────
function renderListView(performances, grid) {
  grid.className = 'grid';
  grid.innerHTML = `
    <div class="list-view">
      <div class="list-header">
        <span>기간</span>
        <span>공연장</span>
        <span>공연명</span>
        <span>장르</span>
        <span>상태</span>
      </div>
      ${performances.map(p => {
        const status = getStatusInfo(p.status);
        return `
          <div class="list-row" data-id="${escHtml(p.id)}" tabindex="0" role="button">
            <div class="list-date">${escHtml(formatDateRange(p.startDate, p.endDate))}</div>
            <div class="list-venue">${escHtml(p.venue || VENUE_CODES[p.venueCode] || '')}</div>
            <div class="list-title">${escHtml(p.name || '제목 없음')}</div>
            <div class="list-genre">${escHtml(genreShort(p.genre))}</div>
            <div class="list-status">
              ${status.label
                ? `<span class="card-status-badge ${status.badgeClass}" style="position:static;backdrop-filter:none;">${status.label}</span>`
                : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;

  grid.querySelectorAll('.list-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(row.dataset.id); }
    });
  });
}

// ── 뷰 버튼 동기화 ────────────────────────────────────────
function updateViewButtons() {
  document.getElementById('cardViewBtn').classList.toggle('active', activeView === 'card');
  document.getElementById('listViewBtn').classList.toggle('active', activeView === 'list');
}

// ── 데이터 로드 ───────────────────────────────────────────
async function loadPerformances() {
  setGridLoading();
  try {
    const res = await fetch('/api/performances');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    allPerformances = data.performances || [];

    const grid = document.getElementById('grid');
    if (data.errors && data.errors.length > 0) {
      const failedNames = data.errors.map(e => e.venue).join(', ');
      const notice = document.createElement('div');
      notice.className = 'error-partial';
      notice.innerHTML = `⚠️ 일부 공연장 조회 실패: <strong>${escHtml(failedNames)}</strong>`;
      grid.parentElement.insertBefore(notice, grid);
    }

    renderGrid(filtered());
  } catch (err) {
    showError(err.message);
  }
}

// ── 로딩 상태 ─────────────────────────────────────────────
function setGridLoading() {
  document.querySelectorAll('.error-partial').forEach(el => el.remove());
  document.getElementById('resultsBar').innerHTML = '';
  document.getElementById('grid').innerHTML = `
    <div class="state-box">
      <div class="spinner"></div>
      <div class="state-msg">9개 공연장의 공연 정보를 불러오는 중...</div>
    </div>`;
}

// ── 오류 상태 ─────────────────────────────────────────────
function showError(msg) {
  document.getElementById('resultsBar').innerHTML = '';
  const isApiKey = msg.includes('KOPIS_API_KEY');
  document.getElementById('grid').innerHTML = `
    <div class="state-box">
      <div class="state-icon">${isApiKey ? '🔑' : '⚠️'}</div>
      <div class="state-title">${isApiKey ? 'API 키가 필요합니다' : '오류가 발생했습니다'}</div>
      <div class="state-msg">
        ${escHtml(msg)}<br><br>
        ${isApiKey
          ? `서버 실행 시 API 키를 설정해 주세요:<br>
             <code>KOPIS_API_KEY=발급받은키 python app.py</code>`
          : '잠시 후 새로고침 버튼을 눌러 다시 시도해 주세요.'}
      </div>
    </div>`;
}

// ── 모달 열기 ─────────────────────────────────────────────
async function openModal(id) {
  const perf = allPerformances.find(p => p.id === id);
  if (!perf) return;

  document.getElementById('mVenue').textContent = perf.venue || VENUE_CODES[perf.venueCode] || '';
  document.getElementById('mTitle').textContent = perf.name || '제목 없음';
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-loading"><div class="spinner"></div></div>`;

  const overlay = document.getElementById('overlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`/api/performances/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();
    renderModalContent(detail, perf);
  } catch (err) {
    renderModalContent(null, perf);
  }
}

// ── 모달 콘텐츠 렌더 ──────────────────────────────────────
function renderModalContent(detail, basic) {
  const d = detail || {};
  const poster    = d.poster    || basic.poster    || '';
  const startDate = d.startDate || basic.startDate || '';
  const endDate   = d.endDate   || basic.endDate   || '';
  const venue     = d.venue     || basic.venue     || VENUE_CODES[basic.venueCode] || '';
  const status    = getStatusInfo(d.status || basic.status);

  // 공연 일시: 쉼표 구분 → 한 줄
  const scheduleText = d.schedule
    ? d.schedule.split(',').map(s => s.trim()).filter(Boolean).join(' / ')
    : '';

  // 좌석별 가격: "원," 기준 파싱
  const priceItems = parsePriceItems(d.price);

  // 출연진
  const castLines = d.cast
    ? d.cast.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const kopisUrl = `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00013&mt20Id=${encodeURIComponent(basic.id)}`;

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-body">
      <div class="modal-poster">${posterModalHtml(poster)}</div>
      <div class="modal-info">

        <div class="info-row">
          <div class="info-label">공연 기간</div>
          <div class="info-val highlight">${escHtml(formatDateRange(startDate, endDate))}</div>
        </div>

        ${scheduleText ? `
        <div class="info-row">
          <div class="info-label">공연 일시</div>
          <div class="info-val">${escHtml(scheduleText)}</div>
        </div>` : ''}

        ${d.runtime ? `
        <div class="info-row">
          <div class="info-label">관람 시간</div>
          <div class="info-val">${escHtml(d.runtime)}</div>
        </div>` : ''}

        ${castLines.length ? `
        <div class="info-row">
          <div class="info-label">출연 아티스트</div>
          <div class="info-val">${castLines.map(c => escHtml(c)).join('<br>')}</div>
        </div>` : ''}

        ${priceItems.length ? `
        <div class="info-row">
          <div class="info-label">좌석별 가격</div>
          <div class="info-val price-list">
            ${priceItems.map(p => `<span class="price-item">${escHtml(p)}</span>`).join('')}
          </div>
        </div>` : ''}

        ${d.age ? `
        <div class="info-row">
          <div class="info-label">관람 연령</div>
          <div class="info-val">${escHtml(d.age)}</div>
        </div>` : ''}

        <div class="info-row">
          <div class="info-label">공연장</div>
          <div class="info-val">${escHtml(venue)}</div>
        </div>

        ${status.label ? `
        <div class="info-row">
          <div class="info-label">공연 상태</div>
          <div class="info-val">
            <span class="card-status-badge ${status.badgeClass}" style="position:static;backdrop-filter:none;">
              ${escHtml(status.label)}
            </span>
          </div>
        </div>` : ''}

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          ${detail && d.relateUrl ? `
          <a href="${escHtml(d.relateUrl)}" target="_blank" rel="noopener noreferrer" class="book-link">
            🎟 예매하기
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>` : ''}
          <a href="${kopisUrl}" target="_blank" rel="noopener noreferrer" class="kopis-link">
            KOPIS에서 보기
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>

        ${!detail ? `
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">
          상세 정보 조회 중 오류가 발생했습니다.
        </p>` : ''}

      </div>
    </div>`;
}

// ── 모달 닫기 ─────────────────────────────────────────────
function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ── 이벤트: 공연장 필터 ───────────────────────────────────
document.getElementById('venueChips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#venueChips .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activeVenue = chip.dataset.venue;
  renderGrid(filtered());
});

// ── 이벤트: 장르 필터 ─────────────────────────────────────
document.getElementById('genreChips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#genreChips .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activeGenre = chip.dataset.genre;
  renderGrid(filtered());
});

// ── 이벤트: 탭 ────────────────────────────────────────────
document.getElementById('tabBar').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeTab = btn.dataset.tab;
  renderGrid(filtered());
});

// ── 이벤트: 뷰 전환 ───────────────────────────────────────
document.getElementById('cardViewBtn').addEventListener('click', () => {
  activeView = 'card';
  localStorage.setItem('view', 'card');
  updateViewButtons();
  renderGrid(filtered());
});
document.getElementById('listViewBtn').addEventListener('click', () => {
  activeView = 'list';
  localStorage.setItem('view', 'list');
  updateViewButtons();
  renderGrid(filtered());
});

// ── 이벤트: 새로고침 ──────────────────────────────────────
document.getElementById('refreshBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  loadPerformances().finally(() => btn.classList.remove('spinning'));
});

// ── 이벤트: 모달 ──────────────────────────────────────────
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('overlay')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── 초기 실행 ─────────────────────────────────────────────
updateViewButtons();
loadPerformances();
