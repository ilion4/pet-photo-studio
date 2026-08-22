// 오늘 방문자 수 카운터.
// - 날짜 기준은 한국시간(KST, UTC+9)
// - 같은 브라우저(쿠키에 저장된 visitorId)는 하루에 한 번만 카운트
// - 자정 지나면 날짜 키가 바뀌면서 자동으로 새로 시작 (별도 리셋 로직 불필요)

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'visitors.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf-8');
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8') || '{}');
  } catch (e) {
    console.error('[visitors] visitors.json 파싱 실패, 빈 객체로 복구:', e.message);
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_FILE);
}

// 한국시간(KST) 기준 오늘 날짜를 'YYYY-MM-DD'로 반환
function todayKstKey() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC+9로 보정
  return kst.toISOString().slice(0, 10);
}

// 오래된 날짜 기록은 계속 쌓이지 않게 최근 며칠치만 남기고 정리
function pruneOldDays(data, keepDays = 7) {
  const keys = Object.keys(data).sort();
  if (keys.length <= keepDays) return data;
  const toRemove = keys.slice(0, keys.length - keepDays);
  toRemove.forEach((k) => delete data[k]);
  return data;
}

// visitorId(쿠키값)를 오늘 방문자로 기록. 이미 기록돼 있으면 중복 카운트 안 함.
function recordVisit(visitorId) {
  if (!visitorId) return getTodayCount();
  const data = readAll();
  const key = todayKstKey();
  if (!data[key]) data[key] = [];
  if (!data[key].includes(visitorId)) {
    data[key].push(visitorId);
    writeAll(pruneOldDays(data));
  }
  return data[key].length;
}

function getTodayCount() {
  const data = readAll();
  const key = todayKstKey();
  return (data[key] || []).length;
}

module.exports = { recordVisit, getTodayCount, todayKstKey };
