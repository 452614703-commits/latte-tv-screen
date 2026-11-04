(function () {
  'use strict';
  var enabled = false, timer = null, overlay = null, events = [];
  function state() {
    try { return window.LatteGetThemeState ? window.LatteGetThemeState() : { status: 'main-script-not-ready' }; }
    catch (error) { return { status: 'state-read-error', error: String(error) }; }
  }
  function send(event, data, includeState) {
    try {
      var report = { event: event, timeMs: Date.now(), data: data || {} };
      if (includeState) report.state = state();
      events.push(report);
      if (events.length > 80) events.shift();
      if (window.LattePosterBridge && typeof window.LattePosterBridge.reportTheme === 'function') {
        window.LattePosterBridge.reportTheme(JSON.stringify(report));
      }
      return report;
    } catch (error) { return { event: 'diagnostics-send-error', error: String(error) }; }
  }
  function paint(s) {
    if (!enabled || !document.body) return;
    if (!overlay) {
      overlay = document.createElement('pre'); overlay.id = 'latteThemeDiagnostics';
      overlay.setAttribute('aria-live', 'off');
      overlay.style.cssText = 'position:fixed;z-index:9999;right:12px;bottom:12px;max-width:53vw;max-height:46vh;overflow:hidden;margin:0;padding:12px 15px;border:1px solid #b5cfdf;border-radius:10px;background:rgba(4,9,15,.92);color:#e7f1f6;font:clamp(11px,1vw,21px)/1.4 monospace;white-space:pre-wrap;pointer-events:none;';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';
    function short(value) { return String(value == null ? '?' : value).slice(0, 145); }
    overlay.textContent = 'V2.10.6 GitHub版 · ' + (s.selfTest ? '临时自检（未改原素材）' : '原海报') + '\n'
      + '素材 ' + (s.index + 1) + '/' + s.count + '  ' + short(s.posterId) + '\n'
      + '当前取色 ' + short(s.currentColor) + '  目标 ' + short(s.targetColor) + '\n'
      + '下一张 ' + short(s.nextId) + '  ' + short(s.nextColor) + '\n'
      + '动画 ' + short(s.animation) + '  入场层透明度 ' + short(s.arrivalOpacity) + '\n'
      + '实际背景CSS ' + short(s.background) + '\n'
      + '实际时钟CSS ' + short(s.clock) + '\n'
      + 'CSS接受渐变 ' + short(s.gradientSupported) + '  时钟节点 ' + short(s.clockNodes) + '\n'
      + '画面仍固定时：管理页下载诊断报告。CSS值不等于屏幕像素。';
  }
  function capture(event) { var report = send(event || 'sample', {}, true); paint(report.state || {}); return report; }
  function setEnabled(value) {
    enabled = !!value;
    if (timer !== null) { clearInterval(timer); timer = null; }
    if (enabled) { capture('diagnostics-on'); timer = setInterval(function () { capture('sample'); }, 2000); }
    else { if (overlay) overlay.style.display = 'none'; send('diagnostics-off', {}, false); }
  }
  window.LatteDiagnostics = { emit: send, capture: capture, isEnabled: function () { return enabled; },
    recent: function () { return events.slice(); } };
  window.LatteSetDiagnosticMode = setEnabled;
  window.addEventListener('error', function (event) {
    send('javascript-error', { message: event.message || 'Resource load error', source: event.filename || '',
      line: event.lineno || 0, stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 1800) : '' }, false);
  });
  window.addEventListener('unhandledrejection', function (event) {
    send('promise-rejection', { message: String(event.reason).slice(0, 1800) }, false);
  });
  document.addEventListener('visibilitychange', function () { capture('visibility-' + document.visibilityState); });
  send('diagnostics-loaded', { version: '2.10.6 GitHub', userAgent: navigator.userAgent }, false);
})();
