// 뱅크다 연동 (인바운드 방식) - "상점 연동 > API 연동 가이드" 문서 스펙 확정 버전
//
//   1) POST /api/bankda/unconfirmed-orders
//      요청: 뱅크다가 body 없이(또는 빈 body로) POST 호출
//      응답: { orders: [{ order_id, buyer_name, billing_name, bank_account_no,
//                          bank_code_name, order_price_amount, order_date,
//                          items: [{ product_name }] }] }
//
//   2) POST /api/bankda/order-detail
//      요청 body: { order_id }
//      응답: { order: { order_id, buyer_name, billing_name, bank_account_no,
//                        bank_code_name, order_price_amount, order_date,
//                        items: [{ product_name }] } }
//      에러: 존재하지 않는 주문번호 -> 415
//
//   3) PUT /api/bankda/confirm-payment   (POST 아니라 PUT!)
//      요청 body: { requests: [{ order_id }, ...] }
//      응답: { return_code: 200, description: "정상",
//              orders: [{ order_id, description: "성공"|실패사유 }] }
//      주의: 전달받은 주문번호가 "입금 전 상태(pending)"일 때만 입금확인 처리해야 함
//
// 참고: bank_account_no / bank_code_name은 "입금자 본인 계좌"가 아니라
//    "우리(사업자) 쪽 수신 계좌 정보"였음 - 사주앱(gyeorun-saju) 코드에서
//    BANK_ACCOUNT_NO, BANK_NAME 환경변수를 그대로 넣고 있는 것을 확인하고 동일하게 수정.
//    (결제 화면에 이미 보여주는 계좌 정보를 그대로 재사용하면 됨 - 입금자에게 별도로
//    본인 은행/계좌번호를 물어볼 필요 없음)

const express = require('express');
const store = require('../lib/store');

function formatKst(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toBankdaOrder(o, merchantBankInfo) {
  return {
    order_id: o.id,
    buyer_name: o.depositorName || '',
    billing_name: o.depositorName || '',
    bank_account_no: merchantBankInfo.account,
    bank_code_name: merchantBankInfo.bank,
    order_price_amount: o.price,
    order_date: formatKst(new Date(o.createdAt)),
    items: [{ product_name: '펫사진관 합성사진 5장' }],
  };
}

const PENDING_STATUSES = ['pending_payment', 'uploaded', 'queued'];

function buildBankdaRouter(processOrderIfReady, merchantBankInfo) {
  const router = express.Router();

  router.post('/unconfirmed-orders', (req, res) => {
    const orders = store
      .listOrders()
      .filter((o) => PENDING_STATUSES.includes(o.status) && o.depositorName);

    res.json({ orders: orders.map((o) => toBankdaOrder(o, merchantBankInfo)) });
  });

  router.post('/order-detail', (req, res) => {
    const { order_id } = req.body || {};
    const order = store.getOrder(order_id);
    if (!order) {
      return res.status(415).json({ return_code: 415, description: '존재하지 않는 주문번호' });
    }
    res.json({ order: toBankdaOrder(order, merchantBankInfo) });
  });

  router.put('/confirm-payment', async (req, res) => {
    const requests = (req.body && req.body.requests) || [];
    const results = [];

    for (const r of requests) {
      const order = store.getOrder(r.order_id);
      if (!order) {
        results.push({ order_id: r.order_id, description: '요청된 주문번호가 없는 경우' });
        continue;
      }
      if (!PENDING_STATUSES.includes(order.status)) {
        results.push({ order_id: r.order_id, description: '요청된 주문번호가 입금대기 상태가 아닌 경우' });
        continue;
      }
      store.updateOrder(order.id, { status: 'paid', paidAt: new Date().toISOString() });
      results.push({ order_id: order.id, description: '성공' });
    }

    res.json({ return_code: 200, description: '정상', orders: results });

    for (const r of results) {
      if (r.description === '성공') {
        processOrderIfReady(r.order_id).catch((e) => console.error('[bankda->processOrder]', e));
      }
    }
  });

  return router;
}

module.exports = { buildBankdaRouter };
