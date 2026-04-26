import os
import logging
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template
from flask_caching import Cache
from apscheduler.schedulers.background import BackgroundScheduler

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

app = Flask(__name__)
app.config['CACHE_TYPE'] = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 21600  # 6 hours

cache = Cache(app)

API_KEY = os.environ.get('KOPIS_API_KEY')
BASE_URL = 'https://kopis.or.kr/openApi/restful'
KST = timezone(timedelta(hours=9))
PERF_CACHE_KEY = 'performances_data'

VENUES = [
    {'code': 'FC000001', 'name': '예술의전당'},
    {'code': 'FC000020', 'name': '세종문화회관'},
    {'code': 'FC003045', 'name': 'LG아트센터 서울'},
    {'code': 'FC000127', 'name': '고양아람누리'},
    {'code': 'FC001513', 'name': '롯데콘서트홀'},
    {'code': 'FC000788', 'name': '마포아트센터 아트홀맥'},
    {'code': 'FC001556', 'name': '금호아트홀 연세'},
    {'code': 'FC003150', 'name': '부천아트센터 콘서트홀'},
    {'code': 'FC001873', 'name': '아트센터인천'},
]

EXCLUDE_KEYWORDS = ['귀국', '발표회', '학생', '졸업']
ALLOWED_GENRES = ['서양음악(클래식)', '한국음악(국악)', '대중음악', '무용(서양/한국무용)']


def xml_text(element, tag, default=''):
    el = element.find(tag)
    return (el.text or '').strip() if el is not None else default


def fetch_venue_performances(venue, stdate, eddate):
    PAGE_SIZE = 100
    all_items = []
    cpage = 1

    while True:
        params = {
            'service': API_KEY,
            'stdate': stdate,
            'eddate': eddate,
            'prfplccd': venue['code'],
            'rows': PAGE_SIZE,
            'cpage': cpage,
        }
        resp = requests.get(f'{BASE_URL}/pblprfr', params=params, timeout=15)
        resp.raise_for_status()

        root = ET.fromstring(resp.text)
        items = root.findall('db')
        all_items.extend(items)

        if len(items) < PAGE_SIZE:
            break
        cpage += 1

    result = []
    for perf in all_items:
        perf_id = xml_text(perf, 'mt20id')
        name = xml_text(perf, 'prfnm')
        genre = xml_text(perf, 'genrenm')

        if not perf_id or genre not in ALLOWED_GENRES:
            continue
        if any(kw in name for kw in EXCLUDE_KEYWORDS):
            continue

        result.append({
            'id': perf_id,
            'name': name,
            'startDate': xml_text(perf, 'prfpdfrom'),
            'endDate': xml_text(perf, 'prfpdto'),
            'venue': xml_text(perf, 'fcltynm') or venue['name'],
            'venueCode': venue['code'],
            'poster': xml_text(perf, 'poster'),
            'genre': genre,
            'status': xml_text(perf, 'prfstate'),
        })

    return result


def fetch_all_performances():
    today = datetime.now(KST)
    end = today + timedelta(days=305)  # ~10개월
    stdate = today.strftime('%Y%m%d')
    eddate = end.strftime('%Y%m%d')

    all_performances = []
    errors = []

    for venue in VENUES:
        try:
            perfs = fetch_venue_performances(venue, stdate, eddate)
            all_performances.extend(perfs)
        except Exception as e:
            errors.append({'venue': venue['name'], 'error': str(e)})
            logging.error(f"[{venue['name']}] 조회 실패: {e}")

    seen: set = set()
    unique = [p for p in all_performances if p['id'] not in seen and not seen.add(p['id'])]  # type: ignore[func-returns-value]
    unique.sort(key=lambda x: x['startDate'])

    return unique, errors, stdate, eddate


def get_cached_performances():
    data = cache.get(PERF_CACHE_KEY)
    if data is None:
        performances, errors, stdate, eddate = fetch_all_performances()
        data = {'performances': performances, 'errors': errors, 'stdate': stdate, 'eddate': eddate}
        cache.set(PERF_CACHE_KEY, data, timeout=21600)
    return data


def warmup_cache():
    with app.app_context():
        cache.delete(PERF_CACHE_KEY)
        try:
            get_cached_performances()
            logging.info('Cache warmup completed.')
        except Exception as e:
            logging.error(f'Cache warmup failed: {e}')


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/performances')
def get_performances():
    if not API_KEY:
        return jsonify({
            'error': 'KOPIS_API_KEY 환경변수가 설정되지 않았습니다. KOPIS_API_KEY=your_key python app.py 로 실행해 주세요.'
        }), 500
    try:
        return jsonify(get_cached_performances())
    except Exception as e:
        logging.error(f'API Error: {e}')
        return jsonify({'error': f'공연 정보를 가져오는 중 오류가 발생했습니다: {e}'}), 500


@app.route('/api/performances/<perf_id>')
def get_performance_detail(perf_id):
    if not API_KEY:
        return jsonify({'error': 'KOPIS_API_KEY 환경변수가 설정되지 않았습니다.'}), 500
    try:
        resp = requests.get(
            f'{BASE_URL}/pblprfr/{perf_id}',
            params={'service': API_KEY},
            timeout=15,
        )
        resp.raise_for_status()

        root = ET.fromstring(resp.text)
        perf = root.find('db')
        if perf is None:
            return jsonify({'error': '공연 정보를 찾을 수 없습니다.'}), 404

        styurls = []
        styurls_el = perf.find('styurls')
        if styurls_el is not None:
            styurls = [el.text for el in styurls_el.findall('styurl') if el.text]

        # relates 필드에서 첫 번째 유효한 예매 URL 추출
        relate_url = ''
        relates_el = perf.find('relates')
        if relates_el is not None:
            for relate in relates_el.findall('relate'):
                url = xml_text(relate, 'relateurl')
                if url and url.startswith('http'):
                    relate_url = url
                    break

        return jsonify({
            'id': xml_text(perf, 'mt20id'),
            'name': xml_text(perf, 'prfnm'),
            'startDate': xml_text(perf, 'prfpdfrom'),
            'endDate': xml_text(perf, 'prfpdto'),
            'venue': xml_text(perf, 'fcltynm'),
            'cast': xml_text(perf, 'prfcast'),
            'crew': xml_text(perf, 'prfcrew'),
            'runtime': xml_text(perf, 'prfruntime'),
            'age': xml_text(perf, 'prfage'),
            'price': xml_text(perf, 'pcseguidance'),
            'schedule': xml_text(perf, 'dtguidance'),
            'poster': xml_text(perf, 'poster'),
            'genre': xml_text(perf, 'genrenm'),
            'status': xml_text(perf, 'prfstate'),
            'styurls': styurls,
            'relateUrl': relate_url,
        })
    except Exception as e:
        logging.error(f'Detail API Error: {e}')
        return jsonify({'error': f'공연 상세 정보를 가져오는 중 오류가 발생했습니다: {e}'}), 500


# APScheduler: 매주 월요일 06:00 KST 캐시 워밍업
scheduler = BackgroundScheduler(timezone='Asia/Seoul')
scheduler.add_job(warmup_cache, 'cron', day_of_week='mon', hour=6, minute=0)
scheduler.start()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f'\n🎵 클래식 공연 일정 서버 실행 중')
    print(f'   http://localhost:{port}\n')
    if not API_KEY:
        print('⚠️  경고: KOPIS_API_KEY 환경변수가 설정되지 않았습니다.')
        print('   실행 방법: KOPIS_API_KEY=your_key python app.py\n')
    app.run(host='0.0.0.0', port=port)
