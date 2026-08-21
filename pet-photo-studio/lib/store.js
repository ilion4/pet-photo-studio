// 주문 데이터를 JSON 파일로 저장/조회하는 아주 단순한 스토어.
// ⚠️ 사주웹앱 개발 때 겪었던 버그: orders.json이 git에 포함되면 배포할 때마다
//    주문 기록이 초기화됨. 반드시 .gitignore에 data/ 추가하고,
//    Railway에 배포할 경우 Volume을 /app/data 에 마운트해서 영구 저장할 것.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'orders.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf-8');
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.error('[store] orders.json 파싱 실패, 빈 객체로 복구:', e.message);
    return {};
  }
}

function writeAll(orders) {
  ensureFile();
  // 임시파일에 먼저 쓰고 rename → 쓰다가 중단돼도 파일이 깨지지 않도록.
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_FILE);
}

function createOrder(order) {
  const orders = readAll();
  orders[order.id] = order;
  writeAll(orders);
  return order;
}

function getOrder(id) {
  const orders = readAll();
  return orders[id] || null;
}

function updateOrder(id, patch) {
  const orders = readAll();
  if (!orders[id]) return null;
  orders[id] = { ...orders[id], ...patch, updatedAt: new Date().toISOString() };
  writeAll(orders);
  return orders[id];
}

function listOrders() {
  const orders = readAll();
  return Object.values(orders).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = { createOrder, getOrder, updateOrder, listOrders };
