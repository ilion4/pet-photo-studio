require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const store = require('./lib/store');
const visitors = require('./lib/visitors');
const { buildBankdaRouter } = require('./routes/bankda');
const { generateFiveImages } = require('./lib/openaiImage');
const { sendResultEmail } = require('./lib/email');

const app = express();
const PORT = process.env.PORT || 3000;
const PRICE = 4800;
const BANK_INFO = {
  bank: process.env.BANK_NAME || '카카오뱅크',
  account: process.env.BANK_ACCOUNT || '3333-00-0000000',
  holder: process.env.BANK_ACCOUNT_HOLDER || '홍길동',
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 별도 패키지 없이 쿠키 헤더를 간단히 파싱 (visitorId 하나만 읽으면 되므로 이 정도로 충분)
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) acc[k] = decodeURIComponent(v.join('=') || '');
    return acc;
  }, {});
}

// ---------- 방문자 기록: 페이지 로드 시 프론트에서 호출 ----------
app.post('/api/visit', (req, res) => {
  const cookies = parseCookies(req);
  let visitorId = cookies.visitorId;
  if (!visitorId) {
    visitorId = nanoid(16);
    // 1년 유지, 이 브라우저에서 오늘 이미 방문 기록했으면 다음 방문부턴 중복 카운트 안 됨
    res.setHeader('Set-Cookie', `visitorId=${visitorId}; Max-Age=31536000; Path=/; SameSite=Lax`);
  }
  const count = visitors.recordVisit(visitorId);
  res.json({ ok: true, todayCount: count });
});

// 볼륨을 하나만 만들어도 되도록 uploads를 data 폴더 아래에 둠 (Railway Volume: /app/data 하나만 마운트하면 됨)
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 원본 파일명의 확장자는 신뢰할 수 없음(길고 이상한 이름, 확장자 없음 등) -
// 브라우저가 실제로 보고하는 mimetype을 기준으로 확장자를 정해서 저장.
// OpenAI 쪽에서 application/octet-stream으로 오인해 400 에러가 났던 문제의 원인.
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.params.orderId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = MIME_TO_EXT[file.mimetype] || '.jpg';
      cb(null, `${file.fieldname}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!MIME_TO_EXT[file.mimetype]) {
      return cb(new Error(`지원하지 않는 이미지 형식입니다 (${file.mimetype}). jpg, png, webp만 가능해요.`));
    }
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// ---------- 1) 주문 생성 (사진 찍기 버튼) ----------
app.post('/api/orders', (req, res) => {
  const id = nanoid(10);
  const order = {
    id,
    price: PRICE,
    depositorName: (req.body && req.body.depositorName) || '',
    status: 'pending_payment', // pending_payment -> uploaded -> queued -> paid -> generating -> completed / failed
    createdAt: new Date().toISOString(),
  };
  store.createOrder(order);
  res.json({ order, bankInfo: BANK_INFO });
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = store.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
  res.json({ order });
});

// 입금자명 등록 (계좌이체 화면에서 입력)
app.post('/api/orders/:orderId/depositor', (req, res) => {
  const { depositorName } = req.body;
  const order = store.updateOrder(req.params.orderId, { depositorName });
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
  res.json({ order });
});

// ---------- 2) 사진 업로드 (사람 사진 + 반려동물 사진) ----------
app.post('/api/orders/:orderId/upload', (req, res) => {
  const handler = upload.fields([{ name: 'personPhoto', maxCount: 1 }, { name: 'petPhoto', maxCount: 1 }]);
  handler(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || '업로드에 실패했습니다.' });
    }
    const order = store.getOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    if (!req.files || !req.files.personPhoto || !req.files.petPhoto) {
      return res.status(400).json({ error: '사람 사진과 반려동물 사진을 모두 업로드해주세요.' });
    }
    const updated = store.updateOrder(order.id, {
      personPhotoPath: req.files.personPhoto[0].path,
      petPhotoPath: req.files.petPhoto[0].path,
      status: order.status === 'pending_payment' ? 'uploaded' : order.status,
    });
    res.json({ order: updated });
  });
});

// ---------- 3) 이메일 입력 → 큐 등록 ----------
app.post('/api/orders/:orderId/email', async (req, res) => {
  const { email } = req.body;
  const order = store.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
  if (!order.personPhotoPath || !order.petPhotoPath) {
    return res.status(400).json({ error: '사진 업로드가 먼저 필요합니다.' });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: '올바른 이메일 주소를 입력해주세요.' });
  }
  const updated = store.updateOrder(order.id, { email, status: order.status === 'paid' ? 'paid' : 'queued' });
  res.json({ order: updated, message: '접수 완료! 입금 확인 후 5~10분 내로 제작해서 이메일로 보내드릴게요.' });
  processOrderIfReady(order.id).catch((e) => console.error('[processOrder]', e));
});

// ---------- 4) 상태 조회 (프론트에서 폴링) ----------
app.get('/api/orders/:orderId/status', (req, res) => {
  const order = store.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
  res.json({ status: order.status });
});

// ---------- 관리자: 주문 목록 / 수동 입금확인 (뱅크다 키 세팅 전 임시용) ----------
app.get('/admin/api/orders', (req, res) => {
  res.json({ orders: store.listOrders() });
});

app.get('/admin/api/visitors/today', (req, res) => {
  res.json({ date: visitors.todayKstKey(), count: visitors.getTodayCount() });
});

app.post('/admin/api/orders/:orderId/confirm-payment', async (req, res) => {
  const order = store.updateOrder(req.params.orderId, { status: 'paid', paidAt: new Date().toISOString() });
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
  res.json({ order });
  processOrderIfReady(order.id).catch((e) => console.error('[processOrder]', e));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------- 뱅크다 인바운드 웹훅 3종 (뱅크다가 이 서버를 호출함) ----------
app.use('/api/bankda', buildBankdaRouter((orderId) => processOrderIfReady(orderId), BANK_INFO));

// ---------- 입금 확인 + 사진 업로드 + 이메일 등록 3박자가 맞으면 생성 시작 ----------
async function processOrderIfReady(orderId) {
  const order = store.getOrder(orderId);
  if (!order) return;
  const ready =
    order.status === 'paid' &&
    order.personPhotoPath &&
    order.petPhotoPath &&
    order.email;
  if (!ready) return;

  store.updateOrder(orderId, { status: 'generating' });
  try {
    const outDir = path.join(UPLOAD_DIR, orderId, 'results');
    let images;
    try {
      images = await generateFiveImages({
        personPhotoPath: order.personPhotoPath,
        petPhotoPath: order.petPhotoPath,
        outDir,
      });
    } catch (e) {
      console.error(`[processOrder] 주문 ${orderId} - 이미지 생성 단계 실패`);
      console.error('  message:', e.message);
      console.error('  status:', e.status);
      console.error('  cause:', e.cause);
      console.error('  stack:', e.stack);
      throw e;
    }
    try {
      await sendResultEmail({ to: order.email, orderId, images });
    } catch (e) {
      console.error(`[processOrder] 주문 ${orderId} - 이메일 발송 단계 실패`);
      console.error('  message:', e.message);
      console.error('  stack:', e.stack);
      throw e;
    }
    store.updateOrder(orderId, { status: 'completed', completedAt: new Date().toISOString() });
  } catch (e) {
    console.error(`[processOrder] 주문 ${orderId} 처리 실패:`, e.message);
    store.updateOrder(orderId, { status: 'failed', error: e.message });
  }
}

app.listen(PORT, () => {
  console.log(`펫 사진관 서버 실행 중: http://localhost:${PORT}`);
  console.log('뱅크다 인바운드 엔드포인트: /api/bankda/unconfirmed-orders, /order-detail, /confirm-payment');
  console.log('관리자 페이지(수동 입금확인): /admin');
});

// ---------- 완료된 주문의 업로드 원본 사진 24시간 후 자동 삭제 ----------
// (메인 페이지 "완성본 발송 후 원본 24시간 내 영구 삭제" 안내가 실제로 지켜지도록)
const DELETE_AFTER_MS = 24 * 60 * 60 * 1000;

function cleanupOldUploads() {
  const orders = store.listOrders();
  const now = Date.now();
  for (const order of orders) {
    if (order.status !== 'completed' || order.filesDeleted) continue;
    const completedAt = order.completedAt ? new Date(order.completedAt).getTime() : null;
    if (!completedAt || now - completedAt < DELETE_AFTER_MS) continue;

    const dir = path.join(UPLOAD_DIR, order.id);
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      store.updateOrder(order.id, { filesDeleted: true, filesDeletedAt: new Date().toISOString() });
      console.log(`[cleanup] 주문 ${order.id} 업로드 원본 삭제 완료 (24시간 경과)`);
    } catch (e) {
      console.error(`[cleanup] 주문 ${order.id} 삭제 실패:`, e.message);
    }
  }
}
setInterval(cleanupOldUploads, 60 * 60 * 1000); // 1시간마다 점검
setTimeout(cleanupOldUploads, 10 * 1000); // 서버 기동 직후 한 번 점검
