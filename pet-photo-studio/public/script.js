(() => {
  // ---------- 0) 빨랫줄 샘플 카드 - 실제 결과물 샘플 사진 13장, 매번 랜덤 순서로 ----------
  const SAMPLE_COUNT = 13;
  const SAMPLE_IMAGES = Array.from({ length: SAMPLE_COUNT }, (_, i) => `images/samples/sample-${i + 1}.jpg`);
  // Fisher-Yates 셔플
  for (let i = SAMPLE_IMAGES.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [SAMPLE_IMAGES[i], SAMPLE_IMAGES[j]] = [SAMPLE_IMAGES[j], SAMPLE_IMAGES[i]];
  }

  const track = document.getElementById('clotheslineTrack');
  const makeCard = (src, i) => {
    const el = document.createElement('div');
    el.className = 'polaroid';
    el.style.setProperty('--tilt', `${(i % 2 === 0 ? -1 : 1) * (2 + (i % 3))}deg`);
    el.innerHTML = `<span class="clip"></span><div class="frame"><img src="${src}" alt="샘플 사진" loading="lazy" /></div>`;
    return el;
  };
  // 두 번 반복해서 넣어야 -50% translateX 애니메이션이 매끄럽게 이어짐
  [...SAMPLE_IMAGES, ...SAMPLE_IMAGES].forEach((src, i) => track.appendChild(makeCard(src, i)));

  // ---------- 상태 ----------
  let orderId = null;
  let files = { personPhoto: null, petPhoto: null };
  let pollTimer = null;

  const overlay = document.getElementById('overlay');
  const panel = document.getElementById('panel');
  const steps = {
    payment: document.getElementById('step-payment'),
    upload: document.getElementById('step-upload'),
    email: document.getElementById('step-email'),
    done: document.getElementById('step-done'),
  };

  function showStep(name) {
    Object.values(steps).forEach((s) => s.classList.add('is-hidden'));
    steps[name].classList.remove('is-hidden');
  }
  function openOverlay() { overlay.classList.add('is-open'); }
  function closeOverlay() {
    overlay.classList.remove('is-open');
    if (pollTimer) clearInterval(pollTimer);
  }

  document.getElementById('panelClose').addEventListener('click', closeOverlay);
  document.getElementById('closeBtn').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

  // ---------- STEP 0 -> 1: 주문 생성 ----------
  document.getElementById('startBtn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      orderId = data.order.id;
      document.getElementById('bankName').textContent = data.bankInfo.bank;
      document.getElementById('bankAccount').textContent = data.bankInfo.account;
      document.getElementById('bankHolder').textContent = data.bankInfo.holder;
      showStep('payment');
      openOverlay();
    } catch (e) {
      alert('주문 생성에 실패했어요. 잠시 후 다시 시도해주세요.');
    }
  });

  // ---------- STEP 1 -> 2: 입금자명 등록 ----------
  document.getElementById('paymentNextBtn').addEventListener('click', async () => {
    const depositorName = document.getElementById('depositorName').value.trim();
    if (!depositorName) { alert('입금자명을 입력해주세요.'); return; }
    await fetch(`/api/orders/${orderId}/depositor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositorName }),
    });
    showStep('upload');
  });

  // ---------- STEP 2: 파일 선택 표시 ----------
  function wireUpload(inputId, boxSelectorIndex, key) {
    const input = document.getElementById(inputId);
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) {
        files[key] = input.files[0];
        input.closest('.upload-box').classList.add('has-file');
        input.closest('.upload-box').querySelector('.upload-desc').textContent = input.files[0].name;
      }
    });
  }
  wireUpload('personPhoto', 0, 'personPhoto');
  wireUpload('petPhoto', 1, 'petPhoto');

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
      btn.disabled = false; btn.textContent = '접수 완료하기';
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
})();
