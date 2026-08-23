# 포근사진관 (사람+반려동물 합성 사진관 웹앱)

사람 증명사진 + 반려동물 사진 → 사진관 배경 합성 사진 5장 → 이메일 발송.
백도령 만세력(사주웹앱)과 동일한 구조: 계좌이체 결제 → 뱅크다 자동확인 → AI 생성 → Resend로 이메일 발송.

## 실행

```bash
npm install
cp .env.example .env   # 값 채워넣기
npm start
```

`http://localhost:3000` 접속. 관리자 페이지는 `http://localhost:3000/admin`.

## 아직 안 채운 것 (나중에 하기로 한 것들)

1. **샘플 사진 / 배경 이미지** — 상단 빨랫줄에 지금은 이모지 placeholder가 걸려있음.
   실제 사진 준비되면 `public/script.js`의 `SAMPLE_ICONS` 배열을 이미지 URL로 교체하고,
   `.polaroid .frame`에 `background-image`를 넣도록 CSS 살짝 수정하면 됨.
2. **뱅크다 연동** — 방향이 반대다: 우리가 뱅크다 API를 호출하는 게 아니라, **뱅크다가 우리 서버를 호출**한다.
   `routes/bankda.js`에 3개 엔드포인트가 구현돼 있음:
   - `GET /api/bankda/unconfirmed-orders` — 입금 확인 필요한 주문 목록
   - `POST /api/bankda/order-detail` — `{order_id}` 받아서 금액/입금자명 반환
   - `POST /api/bankda/confirm-payment` — `{requests:[{order_id}, ...]}` 받아서 입금확인 처리

   배포 후 뱅크다 관리자 화면(설정 → 상점 연동)에서 세 URL을 이 서버의 실제 주소로
   바꿔 넣고, "수동매치 테스트" 버튼으로 하나씩 눌러보면서 응답이 잘 오는지 확인할 것.
   필드명이 뱅크다 쪽 기대와 안 맞으면 그 자리에서 바로 잡으면 됨.
   ⚠️ 뱅크다 무료 요금제는 상점 1개만 등록 가능 — 기존 사주앱이 쓰던 슬롯을 이걸로
   교체했으니, 사주앱은 별도로 수동 입금확인 기능을 추가하기 전까진 결제가 자동으로
   안 끝난다는 점 주의.
3. **OpenAI 이미지 프롬프트 튜닝** — `lib/openaiImage.js`에 5개 스타일 프롬프트가
   영어로 다 들어있음. 실제 생성해보면서 배경/포즈 디테일 조정 필요할 수 있음.
4. **결제 금액-주문 매칭 로직** — 지금은 금액(4,800원) + 입금자명으로 매칭.
   여러 명이 동시에 결제하면 입금자명이 정확히 일치해야 함.

## 배포 (Railway 기준, 사주웹앱과 동일 방식)

- `data/` 폴더는 `.gitignore`에 이미 포함됨 — git에 절대 커밋되면 안 됨
  (커밋되면 배포할 때마다 주문 기록이 초기화되는 버그가 사주웹앱에서 있었음).
- 업로드된 사진도 `data/uploads/` 아래에 저장되도록 구성해서, **Volume은 `/app/data` 하나만
  마운트하면** 주문 기록과 사진이 같이 영구 저장됨.
- 환경변수 넣은 뒤 반드시 **"Apply changes"** 버튼까지 눌러야 실제 반영됨.
- SMTP는 Railway에서 막혀있을 수 있어서 이메일은 Resend HTTP API로 구현해둠.

## 폴더 구조

```
server.js              메인 서버 (주문/결제확인/업로드/생성/발송 라우트)
lib/store.js            JSON 파일 기반 주문 저장소
lib/bankda.js            뱅크다 무통장입금 확인 연동
lib/openaiImage.js       OpenAI 이미지 합성 (5개 스타일)
lib/email.js             Resend 이메일 발송
public/index.html        메인 페이지
public/style.css         디자인
public/script.js         클라이언트 플로우 로직
public/admin.html        임시 관리자 페이지 (수동 입금확인)
```
