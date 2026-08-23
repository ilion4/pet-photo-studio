// 뱅크다 연동 (인바운드 방식)
// ⚠️ 처음에 "우리 서버가 뱅크다 API를 호출한다"고 잘못 짜서 다시 만든 버전.
// 실제 구조: 뱅크다가 우리 서버의 아래 3개 엔드포인트를 주기적으로 호출한다.
//
//   1) GET  /api/bankda/unconfirmed-orders   → 입금 확인이 필요한 주문 목록 반환
//   2) POST /api/bankda/order-detail         → { order_id } 받아서 해당 주문의 금액/입금자명 반환
//   3) POST /api/bankda/confirm-payment      → { requests: [{order_id}, ...] } 받아서 입금 확인 처리
//
// ⚠️ 정확한 요청/응답 필드명은 뱅크다 "API 연동 가이드" 문서를 한 번 더 대조해서 맞춰야 함.
//    아래는 상점연동 화면에 보이던 예시 요청 형식({"order_id": "주문번호"} 등)을 참고해서
//    구성한 초안이고, 배포 후 뱅크다 관리자 화면의 "수동매치 테스트" 버튼으로
//    실제 호출해보면서 필드명이 안 맞으면 바로 조정하면 됨.

const express = require('express');
const store = require('../lib/store');

function buildBankdaRouter(processOrderIfReady) {
  const router = express.Router();

  // 1) 미확인 주문 리스트
  router.get('/unconfirmed-orders', (req, res) => {
    const orders = store
      .listOrders()
      .filter((o) => ['pending_payment', 'uploaded', 'queued'].includes(o.status) && o.depositorName);

    res.json({
      orders: orders.map((o) => ({
        order_id: o.id,
        amount: o.price,
        depositor_name: o.depositorName,
      })),
    });
  });

  // 2) 주문 상세
  router.post('/order-detail', (req, res) => {
    const { order_id } = req.body || {};
    const order = store.getOrder(order_id);
    if (!order) return res.status(404).json({ error: 'NOT_FOUND', order_id });

    res.json({
      order_id: order.id,
      amount: order.price,
      depositor_name: order.depositorName || '',
      status: order.status,
    });
  });

  // 3) 입금 확인 처리 (여러 건 배치로 들어올 수 있음)
  router.post('/confirm-payment', async (req, res) => {
    const requests = (req.body && req.body.requests) || [];
    const results = [];

    for (const r of requests) {
      const order = store.getOrder(r.order_id);
      if (!order) {
        results.push({ order_id: r.order_id, success: false, reason: 'NOT_FOUND' });
        continue;
      }
      store.updateOrder(order.id, { status: 'paid', paidAt: new Date().toISOString() });
      results.push({ order_id: order.id, success: true });
    }

    res.json({ results });

    // 응답은 먼저 보내고, 생성/발송은 비동기로 이어서 진행
    for (const r of results) {
      if (r.success) processOrderIfReady(r.order_id).catch((e) => console.error('[bankda→processOrder]', e));
    }
  });

  return router;
}

module.exports = { buildBankdaRouter };
