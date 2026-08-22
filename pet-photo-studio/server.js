require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const store = require('./lib/store');
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

// 볼륨을 하나만 만들어도 되도록 uploads를 data 폴더 아래에 둠 (Railway Volume: /app/data 하나만 마운트하면 됨)
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.params.orderId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${file.fieldname}${path.extname(file.originalname)}`),
  }),
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
app.post(
  '/api/orders/:orderId/upload',
  upload.fields([{ name: 'personPhoto', maxCount: 1 }, { name: 'petPhoto', maxCount: 1 }]),
  (req, res) => {
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
  }
);

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
    const images = await generateFiveImages({
      personPhotoPath: order.personPhotoPath,
      petPhotoPath: order.petPhotoPath,
      outDir,
    });
    await sendResultEmail({ to: order.email, orderId, images });
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
