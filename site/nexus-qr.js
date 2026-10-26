(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.NexusQrScanner = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (w) {
  'use strict';
  const doc = w.document;
  let session = null, serial = 0;
  function send(receiver, method, value) {
    try {
      if (!w.unityInstance || typeof w.unityInstance.SendMessage !== 'function') return false;
      w.unityInstance.SendMessage(receiver, method, value || '');
      return true;
    } catch (_) { return false; }
  }
  function stopTracks(stream) {
    if (stream) for (const track of stream.getTracks()) track.stop();
  }
  function stopCamera(s) {
    s.generation++;
    if (s.timer !== null) w.clearTimeout(s.timer);
    s.timer = null;
    stopTracks(s.stream); s.stream = null;
    s.video.pause(); s.video.srcObject = null;
    s.canvas.width = s.canvas.height = 0;
    s.switchButton.disabled = true;
  }
  function status(s, message, isError) {
    if (session !== s) return;
    s.message.textContent = message;
    s.message.dataset.error = isError ? 'true' : 'false';
  }
  function close(notify) {
    const s = session;
    if (!s) return;
    session = null;
    stopCamera(s);
    s.root.remove();
    if (s.focusBefore && s.focusBefore.isConnected) s.focusBefore.focus();
    if (notify) send(s.receiver, 'OnNexusQrCancelled', '');
  }
  function validPayload(text, prefix) {
    if (typeof text !== 'string') return false;
    const value = text.trim();
    return value.length <= 4096 && value.length > prefix.length &&
      value.toLowerCase().startsWith(prefix.toLowerCase()) &&
      value.slice(prefix.length).trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
  }
  function cameraError(error) {
    switch (error && error.name) {
      case 'NotAllowedError': case 'SecurityError':
        return 'La cámara está bloqueada. Permite su uso en los ajustes del navegador y pulsa Reintentar. Si el curso está dentro de otra página, esa página también debe permitir la cámara.';
      case 'NotFoundError': case 'DevicesNotFoundError':
        return 'No se encontró una cámara disponible. Conecta una cámara o usa un celular con cámara.';
      case 'NotReadableError': case 'TrackStartError':
        return 'No se pudo abrir la cámara. Cierra otras aplicaciones que la estén usando y reintenta.';
      case 'OverconstrainedError':
        return 'Esta cámara no está disponible. Pulsa Reintentar para usar la cámara predeterminada.';
      default:
        return 'No se pudo iniciar la cámara en este navegador. Reintenta o abre el curso en un navegador con acceso a cámara.';
    }
  }
  function fail(s, message) {
    if (session !== s) return;
    stopCamera(s);
    s.deviceId = '';
    s.startButton.disabled = false;
    s.startButton.textContent = 'Reintentar';
    status(s, message, true);
  }
  function tick(s, generation) {
    if (session !== s || s.generation !== generation) return;
    if (s.video.readyState >= 2 && s.video.videoWidth > 0 && s.video.videoHeight > 0) {
      try {
        const scale = Math.min(1, 640 / Math.max(s.video.videoWidth, s.video.videoHeight));
        s.canvas.width = Math.max(1, Math.round(s.video.videoWidth * scale));
        s.canvas.height = Math.max(1, Math.round(s.video.videoHeight * scale));
        s.context.drawImage(s.video, 0, 0, s.canvas.width, s.canvas.height);
        const frame = s.context.getImageData(0, 0, s.canvas.width, s.canvas.height);
        const code = w.jsQR(frame.data, frame.width, frame.height, {
          inversionAttempts: ++s.frames % 6 === 0 ? 'attemptBoth' : 'dontInvert'
        });
        if (code) {
          if (validPayload(code.data, s.prefix)) {
            const payload = code.data.trim(), receiver = s.receiver;
            close(false); // Release the camera before handing off authentication.
            if (!send(receiver, 'OnNexusQrRead', payload)) {
              open(receiver, s.prefix);
              status(session, 'El curso no pudo recibir el QR. Cierra el lector y vuelve a intentarlo.', true);
            }
            return;
          }
          status(s, 'Ese QR no es un acceso de Nexus. Apunta al QR de tu sesión.', true);
        }
      } catch (_) {
        fail(s, 'No se pudo leer la imagen de la cámara. Pulsa Reintentar.');
        return;
      }
    }
    s.timer = w.setTimeout(function () { tick(s, generation); }, 140);
  }
  async function start(s) {
    if (session !== s) return;
    stopCamera(s);
    const generation = s.generation;
    s.startButton.disabled = true;
    status(s, 'Permite el acceso a la cámara. No se solicita micrófono.', false);
    if (!w.isSecureContext) { fail(s, 'Abre el curso mediante HTTPS para utilizar la cámara.'); return; }
    if (!w.navigator.mediaDevices || !w.navigator.mediaDevices.getUserMedia) {
      fail(s, 'Este navegador no permite acceder a una cámara. Usa un dispositivo y navegador compatibles.'); return;
    }
    if (typeof w.jsQR !== 'function') { fail(s, 'No se cargó el lector QR. Recarga el curso y vuelve a intentarlo.'); return; }
    try {
      const video = s.deviceId ? {deviceId: {exact: s.deviceId}} : {facingMode: {ideal: 'environment'}};
      video.width = {ideal: 1280}; video.height = {ideal: 720}; video.frameRate = {ideal: 15};
      const stream = await w.navigator.mediaDevices.getUserMedia({audio: false, video: video});
      if (session !== s || s.generation !== generation) { stopTracks(stream); return; }
      s.stream = stream; s.video.srcObject = stream;
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', function () {
          if (session === s && s.generation === generation) fail(s, 'La cámara se desconectó. Pulsa Reintentar.');
        }, {once: true});
      }
      await s.video.play();
      if (session !== s || s.generation !== generation) return;
      status(s, 'Apunta al QR generado por Nexus. Mantén el código completo dentro de la imagen.', false);
      s.startButton.textContent = 'Cámara activa';
      tick(s, generation);
      try {
        const devices = await w.navigator.mediaDevices.enumerateDevices();
        if (session !== s || s.generation !== generation) return;
        s.devices = devices.filter(function (d) { return d.kind === 'videoinput' && d.deviceId; });
        const track = stream.getVideoTracks()[0];
        s.deviceId = track && track.getSettings ? track.getSettings().deviceId || '' : '';
        s.switchButton.disabled = s.devices.length < 2;
      } catch (_) { /* Reading still works when device enumeration is unavailable. */ }
    } catch (error) {
      if (session === s && s.generation === generation) fail(s, cameraError(error));
    }
  }
  function open(receiver, prefix) {
    close(false);
    const root = doc.createElement('section');
    root.id = 'nexus-qr-modal'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'nexus-qr-title');
    root.innerHTML = '<div class="nq-card"><header><div><span class="nq-eyebrow">ACCESO DEL ALUMNO</span><h2 id="nexus-qr-title">Escanear QR de Nexus</h2></div><button type="button" class="nq-close" aria-label="Cerrar lector QR">✕</button></header><div class="nq-layout"><div class="nq-preview"><video muted playsinline aria-label="Vista previa de la cámara"></video><span class="nq-corners" aria-hidden="true"></span><span class="nq-badge">LECTOR QR</span></div><div class="nq-controls"><p class="nq-status" role="status" aria-live="polite"></p><p class="nq-privacy">La imagen se procesa en este dispositivo. No se graba ni se envía el video.</p><button type="button" class="nq-start">Activar cámara</button><button type="button" class="nq-switch" disabled>Cambiar cámara</button><button type="button" class="nq-cancel">Cancelar</button></div></div></div>';
    const canvas = doc.createElement('canvas');
    const s = {id: ++serial, root: root, receiver: receiver, prefix: typeof prefix === 'string' && prefix.length > 0 && prefix.length < 128 ? prefix : 'nexusvr:',
      video: root.querySelector('video'), canvas: canvas, context: canvas.getContext('2d', {willReadFrequently: true}),
      message: root.querySelector('.nq-status'), startButton: root.querySelector('.nq-start'), switchButton: root.querySelector('.nq-switch'),
      stream: null, timer: null, generation: 0, frames: 0, devices: [], deviceId: '', focusBefore: doc.activeElement};
    s.video.muted = true; s.video.playsInline = true;
    session = s; doc.body.appendChild(root);
    status(s, 'Pulsa Activar cámara y muestra el QR que generó Nexus para tu sesión.', false);
    root.querySelector('.nq-close').addEventListener('click', function () { close(true); });
    root.querySelector('.nq-cancel').addEventListener('click', function () { close(true); });
    s.startButton.addEventListener('click', function () { start(s); });
    s.switchButton.addEventListener('click', function () {
      if (session !== s || s.devices.length < 2) return;
      const index = s.devices.findIndex(function (d) { return d.deviceId === s.deviceId; });
      s.deviceId = s.devices[(index + 1) % s.devices.length].deviceId;
      start(s);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      if (e.key === 'Tab') {
        const controls = Array.from(root.querySelectorAll('button')).filter(function (b) { return !b.disabled; });
        if (e.shiftKey && doc.activeElement === controls[0]) { e.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!e.shiftKey && doc.activeElement === controls[controls.length - 1]) { e.preventDefault(); controls[0].focus(); }
      }
    });
    s.startButton.focus();
  }
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) close(true); });
  w.addEventListener('pagehide', function () { close(false); });
  return {open: open, close: function () { close(false); }};
});
