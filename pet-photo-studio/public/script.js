(() => {
  // ---------- 방문 기록 (관리자 페이지 오늘 방문자 수 카운트용) ----------
  fetch('/api/visit', { method: 'POST' }).catch(() => {});

  // ---------- 갤러리: 실제 결과물 샘플 12장을 매번 랜덤 순서로 ----------
  const GALLERY_FILES = [
    'sample-1.jpg', 'sample-2.jpg', 'sample-3.jpg', 'sample-4.jpg',
    'sample-5.jpg', 'sample-6.jpg', 'sample-7.jpg', 'sample-8.jpg',
    'sample-9.jpg', 'sample-13.jpg', 'sample-14.jpg', 'sample-15.jpg',
  ];
  // Fisher-Yates 셔플
  for (let i = GALLERY_FILES.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [GALLERY_FILES[i], GALLERY_FILES[j]] = [GALLERY_FILES[j], GALLERY_FILES[i]];
  }
  const galleryGrid = document.getElementById('galleryGrid');
  if (galleryGrid) {
    galleryGrid.innerHTML = GALLERY_FILES.map(
      (f) => `<div class="gallery-tile"><img src="images/samples/${f}" alt="완성 사진" loading="lazy"></div>`
    ).join('');
  }

  // ---------- 카카오 SDK 초기화 ----------
  const KAKAO_JS_KEY = '422fd89fbe88f21919c79e4654078d70';
  if (typeof Kakao !== 'undefined' && !Kakao.isInitialized()) {
    try { Kakao.init(KAKAO_JS_KEY); } catch (e) { console.error('[kakao] 초기화 실패', e); }
  }

  // ---------- 상태 ----------
  let orderId = null;
  let files = { personPhoto: null, petPhoto: null };
  let pollTimer = null;

  const steps = {
    payment: document.getElementById('step-payment'),
    upload: document.getElementById('step-upload'),
    email: document.getElementById('step-email'),
    done: document.getElementById('step-done'),
  };
  const stepOrder = ['payment', 'upload', 'email', 'done'];

  function showStep(name) {
    Object.values(steps).forEach((s) => s.classList.add('hidden'));
    steps[name].classList.remove('hidden');
    const idx = stepOrder.indexOf(name);
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.classList.remove('active', 'done');
      if (i < idx) dot.classList.add('done');
      if (i === idx) dot.classList.add('active');
    });
  }

  // ---------- 페이지 로드 시 주문을 미리 만들어 계좌 정보 즉시 표시 ----------
  async function initOrder() {
    try {
      const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      orderId = data.order.id;
      document.getElementById('bankName').textContent = data.bankInfo.bank;
      document.getElementById('bankAccount').textContent = data.bankInfo.account;
      document.getElementById('bankHolder').textContent = data.bankInfo.holder;
    } catch (e) {
      console.error('[order] 주문 생성 실패', e);
    }
  }
  initOrder();

  // ---------- 계좌번호 복사 ----------
  document.getElementById('copyAccountBtn').addEventListener('click', async () => {
    const btn = document.getElementById('copyAccountBtn');
    const accountNo = document.getElementById('bankAccount').textContent.trim();
    if (!accountNo || accountNo === '-') return;
    try {
      await navigator.clipboard.writeText(accountNo);
    } catch (e) {
      const temp = document.createElement('textarea');
      temp.value = accountNo;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    const original = btn.textContent;
    btn.textContent = '복사됨';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
  });

  // ---------- STEP 1 -> 2: 입금자명 등록 ----------
  document.getElementById('paymentNextBtn').addEventListener('click', async () => {
    const depositorName = document.getElementById('depositorName').value.trim();
    if (!depositorName) { alert('입금자명을 입력해주세요.'); return; }
    if (!orderId) { alert('잠시 후 다시 시도해주세요.'); return; }
    await fetch(`/api/orders/${orderId}/depositor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositorName }),
    });
    showStep('upload');
  });

  // ---------- STEP 2: 파일 선택 + 미리보기 ----------
  function wireUpload(inputId, previewId, key) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) {
        files[key] = input.files[0];
        const dropzone = input.closest('.dropzone');
        dropzone.classList.add('has-file');
        dropzone.querySelector('.dz-placeholder').style.display = 'none';
        preview.src = URL.createObjectURL(input.files[0]);
        preview.classList.remove('hidden');
      }
    });
  }
  wireUpload('personPhoto', 'personPreview', 'personPhoto');
  wireUpload('petPhoto', 'petPreview', 'petPhoto');

  // ---------- STEP 2 -> 3: 업로드 ----------
  document.getElementById('uploadNextBtn').addEventListener('click', async () => {
    if (!files.personPhoto || !files.petPhoto) {
      alert('사람 사진과 반려동물 사진을 모두 선택해주세요.');
      return;
    }
    const btn = document.getElementById('uploadNextBtn');
    btn.disabled = true; btn.textContent = '업로드 중…';
    try {
      const fd = new FormData();
      fd.append('personPhoto', files.personPhoto);
      fd.append('petPhoto', files.petPhoto);
      const res = await fetch(`/api/orders/${orderId}/upload`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('업로드 실패');
      showStep('email');
    } catch (e) {
      alert('업로드에 실패했어요. 다시 시도해주세요.');
    } finally {
      btn.disabled = false; btn.textContent = '업로드하고 다음';
    }
  });

  // ---------- STEP 3 -> 4: 이메일 접수 ----------
  document.getElementById('emailSubmitBtn').addEventListener('click', async () => {
    const email = document.getElementById('emailInput').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('올바른 이메일 주소를 입력해주세요.'); return; }
    const btn = document.getElementById('emailSubmitBtn');
    btn.disabled = true; btn.textContent = '접수 중…';
    try {
      const res = await fetch(`/api/orders/${orderId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('접수 실패');
      showStep('done');
      startPolling();
    } catch (e) {
      alert('접수에 실패했어요. 다시 시도해주세요.');
    } finally {
      btn.disabled = false; btn.textContent = '4,800원 신청 완료하기';
    }
  });

  // ---------- STEP 4: 상태 폴링 ----------
  const STATUS_TEXT = {
    pending_payment: '입금 확인을 기다리는 중이에요…',
    uploaded: '입금 확인을 기다리는 중이에요…',
    queued: '입금 확인을 기다리는 중이에요…',
    paid: '입금 확인 완료! 사진을 만들고 있어요…',
    generating: '사진을 만들고 있어요…',
    completed: '완성돼서 이메일로 보내드렸어요! 📮',
    failed: '앗, 제작 중 문제가 생겼어요. 확인 후 다시 안내드릴게요.',
  };
  function startPolling() {
    const line = document.getElementById('statusLine');
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/status`);
        const data = await res.json();
        line.textContent = STATUS_TEXT[data.status] || STATUS_TEXT.pending_payment;
        if (data.status === 'completed' || data.status === 'failed') clearInterval(pollTimer);
      } catch (e) { /* 다음 폴링에서 재시도 */ }
    }, 8000);
  }

  // ---------- 공유하기: 카카오톡 공유 카드 우선, SDK 문제 있으면 공유시트/링크복사로 대체 ----------
  document.getElementById('shareBtn').addEventListener('click', async () => {
    const siteUrl = window.location.origin;
    const shareData = {
      title: '행복한사진관',
      text: '반려동물과 함께 사진관에서 찍은 듯한 사진을 만들어드려요 🐾',
      url: siteUrl,
    };
    const btn = document.getElementById('shareBtn');

    const kakaoObj = typeof Kakao !== 'undefined' ? Kakao : null;
    const kakaoReady = !!(kakaoObj && kakaoObj.isInitialized && kakaoObj.isInitialized());

    if (kakaoReady) {
      const shareTarget = (kakaoObj.Share && kakaoObj.Share.sendDefault) ? kakaoObj.Share
        : (kakaoObj.Link && kakaoObj.Link.sendDefault) ? kakaoObj.Link
        : null;
      if (shareTarget) {
        try {
          shareTarget.sendDefault({
            objectType: 'feed',
            content: {
              title: shareData.title,
              description: shareData.text,
              imageUrl: `${siteUrl}/images/samples/sample-1.jpg`,
              link: { mobileWebUrl: siteUrl, webUrl: siteUrl },
            },
            buttons: [
              { title: '사진 찍으러 가기', link: { mobileWebUrl: siteUrl, webUrl: siteUrl } },
            ],
          });
          return;
        } catch (e) {
          console.error('[kakao] 공유 호출 실패, 대체 방식으로 전환', e);
        }
      }
    }

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e) {
        /* 사용자가 공유 취소한 경우 등 - 무시 */
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareData.url);
        const original = btn.textContent;
        btn.textContent = '링크가 복사됐어요!';
        setTimeout(() => { btn.textContent = original; }, 2000);
      } catch (e) {
        alert(`아래 링크를 복사해서 공유해주세요:\n${shareData.url}`);
      }
    }
  });
})();
