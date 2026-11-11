(function () {
  const SDK_URLS = [
    'https://download.agora.io/sdk/release/AgoraRTC_N.js',
    'https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng/AgoraRTC_N-production.js'
  ];

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-agora-sdk="' + url + '"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('视频组件加载失败。')));
        if (window.AgoraRTC) resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.agoraSdk = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('视频组件加载失败。'));
      document.head.appendChild(script);
    });
  }

  async function loadAgora() {
    if (window.AgoraRTC && typeof window.AgoraRTC.createClient === 'function') return window.AgoraRTC;
    let lastError = null;
    for (const url of SDK_URLS) {
      try {
        await loadScript(url);
        if (window.AgoraRTC && typeof window.AgoraRTC.createClient === 'function') return window.AgoraRTC;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('视频组件加载失败。');
  }

  async function requestToken(channel, uid) {
    const response = await fetch('/api/rtc-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, uid })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token || !data.appId) {
      throw new Error(data.error || '视频连线凭证取得失败。');
    }
    return data;
  }

  function fitPlayer(slot) {
    slot.querySelectorAll('div, video').forEach((node) => {
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.objectFit = 'cover';
    });
  }

  function fieldText(value) {
    const text = String(value || '').trim();
    return text || '—';
  }

  function renderPhotos(photos) {
    const list = Array.isArray(photos) ? photos : [];
    if (!list.length) return '<p class="room-empty">尚无附件</p>';
    return '<div class="room-photos">' + list.map((photo) => {
      const url = String(photo.url || '');
      const caption = escapeHtml(photo.caption || '附件');
      return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer"><img src="' + escapeHtml(url) + '" alt="' + caption + '"></a>';
    }).join('') + '</div>';
  }

  function renderShell(info) {
    const number = escapeHtml(fieldText(info.caseNumber));
    return '' +
      '<div class="room-status" data-slot="status">正在打开镜头。</div>' +
      '<div class="room-layout">' +
        '<section class="room-stage">' +
          '<h2>线上笔录</h2>' +
          '<div class="room-videos">' +
            '<div class="room-video"><div class="room-screen" data-slot="local"></div><p data-slot="localLabel">我方（镜头未开启）</p></div>' +
            '<div class="room-video"><div class="room-screen waiting" data-slot="remote"><span>等待承办人进入笔录</span></div><p>承办人</p></div>' +
          '</div>' +
          '<p class="room-line" data-slot="line">正在打开镜头。</p>' +
          '<p class="room-live" data-slot="live">笔录视讯准备中</p>' +
          '<div class="room-actions">' +
            '<button type="button" data-action="leave">结束笔录</button>' +
            '<button type="button" data-action="mic" disabled>关闭麦克风</button>' +
            '<button type="button" class="light" data-action="sound" disabled>播放声音</button>' +
          '</div>' +
          '<form class="room-chat" data-slot="chatForm">' +
            '<div class="room-log" data-slot="log"></div>' +
            '<div class="room-compose"><input data-slot="chatInput" maxlength="280" placeholder="输入消息" autocomplete="off"><button type="submit">发送</button></div>' +
          '</form>' +
        '</section>' +
        '<aside class="room-card">' +
          '<h3>笔录编号 ' + number + '</h3>' +
          '<table><tbody>' +
            '<tr><th>公文</th><td>' + escapeHtml(fieldText(info.documentOfficial)) + '</td></tr>' +
            '<tr><th>案由</th><td>' + escapeHtml(fieldText(info.caseReason)) + '</td></tr>' +
            '<tr><th>单位</th><td>' + escapeHtml(fieldText(info.caseUnit)) + '</td></tr>' +
            '<tr><th>命令</th><td>' + escapeHtml(fieldText(info.caseOrder)) + '</td></tr>' +
          '</tbody></table>' +
          renderPhotos(info.photos) +
        '</aside>' +
      '</div>';
  }

  async function open(container, options) {
    const AgoraRTC = await loadAgora();
    const info = options.caseInfo || {};
    const channel = String(info.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(channel)) {
      throw new Error('这件案件无法建立视讯。');
    }

    container.innerHTML = renderShell(info);
    const localSlot = container.querySelector('[data-slot="local"]');
    const remoteSlot = container.querySelector('[data-slot="remote"]');
    const status = container.querySelector('[data-slot="status"]');
    const line = container.querySelector('[data-slot="line"]');
    const live = container.querySelector('[data-slot="live"]');
    const localLabel = container.querySelector('[data-slot="localLabel"]');
    const micButton = container.querySelector('[data-action="mic"]');
    const soundButton = container.querySelector('[data-action="sound"]');
    const log = container.querySelector('[data-slot="log"]');
    const chatForm = container.querySelector('[data-slot="chatForm"]');
    const chatInput = container.querySelector('[data-slot="chatInput"]');

    let cameraTrack = null;
    let micTrack = null;
    let client = null;
    let soundOn = false;
    let micOn = false;
    let closed = false;
    let lastChatId = '';
    let chatTimer = 0;
    const remoteAudio = new Map();

    function setStatus(text) {
      status.textContent = text;
      line.textContent = text;
    }

    function updateLabels() {
      localLabel.textContent = '我方（镜头已开启／麦克风' + (micOn ? '已开启' : '已关闭') + '）';
      micButton.textContent = micOn ? '关闭麦克风' : '开启麦克风';
    }

    function applySound() {
      remoteAudio.forEach((track) => {
        if (typeof track.setVolume === 'function') track.setVolume(soundOn ? 100 : 0);
      });
      soundButton.textContent = soundOn ? '关闭声音' : '播放声音';
    }

    async function closeRoom(notify) {
      if (closed) return;
      closed = true;
      clearInterval(chatTimer);
      remoteAudio.clear();
      [cameraTrack, micTrack].filter(Boolean).forEach((track) => {
        track.stop();
        track.close();
      });
      cameraTrack = null;
      micTrack = null;
      if (client) {
        client.removeAllListeners();
        await client.leave().catch(() => {});
        client = null;
      }
      if (notify && typeof options.onLeave === 'function') options.onLeave();
    }

    try {
      cameraTrack = await AgoraRTC.createCameraVideoTrack();
    } catch (error) {
      container.innerHTML = '';
      throw new Error('镜头未开启，请重新进入。');
    }

    cameraTrack.play(localSlot, { fit: 'cover', mirror: true });
    fitPlayer(localSlot);
    try {
      micTrack = await AgoraRTC.createMicrophoneAudioTrack();
      micOn = true;
    } catch (error) {
      micOn = false;
    }
    micButton.disabled = !micTrack;
    soundButton.disabled = false;
    updateLabels();

    async function failAfterCamera(error) {
      await closeRoom(false);
      container.innerHTML = '';
      throw error;
    }

    client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    client.on('user-published', async (user, mediaType) => {
      if (closed) return;
      await client.subscribe(user, mediaType);
      if (mediaType === 'video' && user.videoTrack) {
        remoteSlot.classList.remove('waiting');
        remoteSlot.innerHTML = '';
        user.videoTrack.play(remoteSlot, { fit: 'cover' });
        fitPlayer(remoteSlot);
        setStatus('承办人已进入笔录。');
      }
      if (mediaType === 'audio' && user.audioTrack) {
        remoteAudio.set(String(user.uid), user.audioTrack);
        user.audioTrack.play();
        applySound();
      }
    });
    client.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'video') {
        remoteSlot.classList.add('waiting');
        remoteSlot.innerHTML = '<span>等待承办人进入笔录</span>';
      }
      if (mediaType === 'audio') remoteAudio.delete(String(user.uid));
    });
    client.on('user-left', (user) => {
      remoteAudio.delete(String(user.uid));
      remoteSlot.classList.add('waiting');
      remoteSlot.innerHTML = '<span>等待承办人进入笔录</span>';
      setStatus('已连线，等待对方视讯／语音。');
    });

    const uid = String(options.uid || 'guest');
    let token;
    try {
      token = await requestToken(channel, uid);
      await client.join(token.appId, channel, token.token, token.uid);
      const tracks = [micTrack, cameraTrack].filter(Boolean);
      if (tracks.length) await client.publish(tracks);
    } catch (error) {
      await failAfterCamera(error instanceof Error ? error : new Error('视讯连线失败。'));
    }

    setStatus('笔录进行中。要离开请按「结束笔录」。');
    live.textContent = '笔录视讯进行中';
    line.textContent = '已连线，等待对方视讯／语音。';

    container.querySelector('[data-action="leave"]').addEventListener('click', async () => {
      if (!window.confirm('结束笔录会关闭镜头。确定结束？')) return;
      await closeRoom(true);
    });
    micButton.addEventListener('click', async () => {
      if (!micTrack) return;
      micOn = !micOn;
      await micTrack.setEnabled(micOn);
      updateLabels();
    });
    soundButton.addEventListener('click', () => {
      soundOn = !soundOn;
      applySound();
    });

    function appendMessage(message) {
      const row = document.createElement('p');
      row.textContent = (message.sender || '访客') + '：' + (message.text || '');
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    async function pullChat() {
      if (closed) return;
      const response = await fetch('/api/video-chat?channel=' + encodeURIComponent(channel) + '&after=' + encodeURIComponent(lastChatId));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      (data.messages || []).forEach((message) => {
        appendMessage(message);
        lastChatId = String(message.id || lastChatId);
      });
    }

    chatForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!text || closed) return;
      chatInput.value = '';
      const response = await fetch('/api/video-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, sender: options.senderName || '访客', text })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(data.error || '消息发送失败。');
        return;
      }
      if (data.message) {
        appendMessage(data.message);
        lastChatId = String(data.message.id || lastChatId);
      }
    });

    await pullChat();
    chatTimer = setInterval(() => { pullChat().catch(() => {}); }, 2000);

    return { close: () => closeRoom(false) };
  }

  window.ReportRoom = { open };
})();
