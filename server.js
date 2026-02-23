require('dotenv').config();

const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.KOPIS_API_KEY;
const BASE_URL = 'https://kopis.or.kr/openApi/restful';

const VENUES = [
  { code: 'FC000001', name: '예술의전당' },
  { code: 'FC000020', name: '세종문화회관' },
  { code: 'FC003045', name: 'LG아트센터 서울' },
  { code: 'FC000127', name: '고양아람누리' },
  { code: 'FC001513', name: '롯데콘서트홀' },
  { code: 'FC000788', name: '마포아트센터 아트홀맥' },
  { code: 'FC001556', name: '금호아트홀 연세' },
  { code: 'FC003150', name: '부천아트센터 콘서트홀' },
  { code: 'FC001873', name: '아트센터인천' },
];

const EXCLUDE_KEYWORDS = ['귀국', '발표회', '학생', '졸업'];

// 허용 장르명 (KOPIS 응답의 genrenm 기준)
const ALLOWED_GENRES = ['서양음악(클래식)', '한국음악(국악)', '대중음악', '무용(서양/한국무용)'];

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function parseXml(xmlString) {
  return xml2js.parseStringPromise(xmlString, { explicitArray: true });
}

async function fetchVenuePerformances(venue, stdate, eddate) {
  const params = {
    service: API_KEY,
    stdate,
    eddate,
    prfplccd: venue.code,
    rows: 100,
    cpage: 1,
  };

  const response = await axios.get(`${BASE_URL}/pblprfr`, {
    params,
    timeout: 15000,
  });

  const parsed = await parseXml(response.data);
  const items = parsed?.dbs?.db || [];

  return items
    .map(perf => ({
      id: perf.mt20id?.[0] || '',
      name: perf.prfnm?.[0] || '',
      startDate: perf.prfpdfrom?.[0] || '',
      endDate: perf.prfpdto?.[0] || '',
      venue: perf.fcltynm?.[0] || venue.name,
      venueCode: venue.code,
      poster: perf.poster?.[0] || '',
      genre: perf.genrenm?.[0] || '',
      status: perf.prfstate?.[0] || '',
    }))
    .filter(p =>
      p.id &&
      ALLOWED_GENRES.includes(p.genre) &&
      !EXCLUDE_KEYWORDS.some(kw => p.name.includes(kw))
    );
}

// Static files (index.html, script.js)
app.use(express.static(path.join(__dirname)));

// GET /api/performances - 전체 공연 목록
app.get('/api/performances', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: 'KOPIS_API_KEY 환경변수가 설정되지 않았습니다. 서버를 KOPIS_API_KEY=YOUR_KEY node server.js 로 실행해 주세요.',
    });
  }

  const today = new Date();
  const endDate = new Date(today);
  endDate.setMonth(endDate.getMonth() + 10);

  const stdate = formatDate(today);
  const eddate = formatDate(endDate);

  try {
    const results = await Promise.allSettled(
      VENUES.map(venue => fetchVenuePerformances(venue, stdate, eddate))
    );

    const allPerformances = [];
    const errors = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        allPerformances.push(...result.value);
      } else {
        errors.push({ venue: VENUES[i].name, error: result.reason?.message });
        console.error(`[${VENUES[i].name}] 조회 실패:`, result.reason?.message);
      }
    }

    // ID 중복 제거
    const seen = new Set();
    const unique = allPerformances.filter(p => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    // 시작일 기준 정렬
    unique.sort((a, b) => a.startDate.localeCompare(b.startDate));

    res.json({ performances: unique, errors, stdate, eddate });
  } catch (err) {
    console.error('API Error:', err.message);
    res.status(500).json({ error: '공연 정보를 가져오는 중 오류가 발생했습니다: ' + err.message });
  }
});

// GET /api/performances/:id - 공연 상세 정보
app.get('/api/performances/:id', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'KOPIS_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const response = await axios.get(`${BASE_URL}/pblprfr/${req.params.id}`, {
      params: { service: API_KEY },
      timeout: 15000,
    });

    const parsed = await parseXml(response.data);
    const perf = parsed?.dbs?.db?.[0];

    if (!perf) {
      return res.status(404).json({ error: '공연 정보를 찾을 수 없습니다.' });
    }

    // styurls 처리 (공연 이미지 목록)
    let styurls = [];
    const styurlsRaw = perf.styurls?.[0];
    if (styurlsRaw && styurlsRaw.styurl) {
      styurls = styurlsRaw.styurl.map(u => (typeof u === 'string' ? u : u._ || ''));
    }

    res.json({
      id: perf.mt20id?.[0] || '',
      name: perf.prfnm?.[0] || '',
      startDate: perf.prfpdfrom?.[0] || '',
      endDate: perf.prfpdto?.[0] || '',
      venue: perf.fcltynm?.[0] || '',
      cast: perf.prfcast?.[0] || '',
      crew: perf.prfcrew?.[0] || '',
      runtime: perf.prfruntime?.[0] || '',
      age: perf.prfage?.[0] || '',
      price: perf.pcseguidance?.[0] || '',
      schedule: perf.dtguidance?.[0] || '',
      poster: perf.poster?.[0] || '',
      genre: perf.genrenm?.[0] || '',
      status: perf.prfstate?.[0] || '',
      styurls,
    });
  } catch (err) {
    console.error('Detail API Error:', err.message);
    res.status(500).json({ error: '공연 상세 정보를 가져오는 중 오류가 발생했습니다: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎵 클래식 공연 일정 서버 실행 중`);
  console.log(`   http://localhost:${PORT}\n`);
  if (!API_KEY) {
    console.warn('⚠️  경고: KOPIS_API_KEY 환경변수가 설정되지 않았습니다.');
    console.warn('   실행 방법: KOPIS_API_KEY=your_key node server.js\n');
  }
});
