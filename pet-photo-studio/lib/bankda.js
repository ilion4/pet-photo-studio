// 뱅크다(무통장입금 자동 확인 서비스) 연동
// 사주웹앱(백도령 만세력)에서 이미 검증한 구조를 그대로 재사용:
//   1) 미확인주문리스트 조회
//   2) 주문상세 조회
//   3) 입금확인 처리
// 날짜 포맷은 반드시 'YYYY-MM-DD HH:mm:ss' (KST) — 이 형식이 아니면 뱅크다 쪽에서 거부함.
//
// ⚠️ BANKDA_API_ID / BANKDA_API_KEY 환경변수가 없으면 "수동확인 모드"로 자동 전환되어
//    관리자 페이지(/admin)에서 입금확인 버튼을 눌러 처리할 수 있음.
//    실제 서비스 전에는 반드시 뱅크다 발급 키를 Railway 환경변수에 넣고
//    "Apply changes"까지 눌러야 실제로 반영된다 (사주웹앱 트러블슈팅 경험).

const fetch = require('node-fetch');

const BANKDA_BASE = 'https://openapi.bankda.com'; // 실제 엔드포인트는 뱅크다 계약 시 안내받은 주소로 교체
const API_ID = process.env.BANKDA_API_ID;
const API_KEY = process.env.BANKDA_API_KEY;
const DEPOSIT_ACCOUNT_HOLDER = process.env.BANK_ACCOUNT_HOLDER || '';

function isConfigured() {
  return Boolean(API_ID && API_KEY);
}

function formatKst(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 주문번호(orderId)와 입금자명으로 매칭되는 미확인 입금이 있는지 조회.
// 실 서비스 연동 시 뱅크다 문서의 실제 파라미터명으로 맞춰줄 것.
async function checkDeposit(order) {
  if (!isConfigured()) {
    return { matched: false, mode: 'manual', reason: 'BANKDA API 키 미설정 - 관리자 수동확인 필요' };
  }

  try {
    const res = await fetch(`${BANKDA_BASE}/v1/deposits/unconfirmed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'X-API-ID': API_ID,
      },
      body: JSON.stringify({
        from: formatKst(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        to: formatKst(new Date()),
      }),
    });

    if (!res.ok) {
      console.error('[bankda] 미확인주문리스트 조회 실패', res.status);
      return { matched: false, mode: 'api', reason: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const list = data.items || data.list || [];

    const matched = list.find(
      (row) =>
        String(row.amount) === String(order.price) &&
        (row.depositorName === order.depositorName || row.memo === order.id)
    );

    if (!matched) return { matched: false, mode: 'api' };

    // 3) 입금확인 처리
    await fetch(`${BANKDA_BASE}/v1/deposits/${matched.depositId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'X-API-ID': API_ID,
      },
    });

    return { matched: true, mode: 'api', deposit: matched };
  } catch (e) {
    console.error('[bankda] 입금확인 중 오류:', e.message);
    return { matched: false, mode: 'api', reason: e.message };
  }
}

module.exports = { checkDeposit, isConfigured, DEPOSIT_ACCOUNT_HOLDER };
