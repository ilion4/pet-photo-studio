// Resend HTTP API(HTTPS 443)로 이메일 발송.
// ⚠️ SMTP(465/587)는 Railway에서 통째로 막혀있는 경우가 많음 (사주웹앱에서 이미 확인됨).
//    반드시 HTTP API 방식 사용.

const fs = require('fs');
const fetch = require('node-fetch');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM || 'studio@example.com';

async function sendResultEmail({ to, orderId, images }) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY 환경변수가 설정되어 있지 않습니다.');
  }

  const attachments = images.map((img) => ({
    filename: `${img.label}.png`,
    content: fs.readFileSync(img.path).toString('base64'),
  }));

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject: '[사진관] 가족사진이 도착했어요 🐾',
      html: `<p>주문번호 ${orderId}, 소중한 가족사진 5장을 보내드려요.</p><p>첨부파일을 확인해주세요.</p>`,
      attachments,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend 발송 실패 (HTTP ${res.status}): ${text}`);
  }

  return res.json();
}

module.exports = { sendResultEmail };
