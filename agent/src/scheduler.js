function startScheduler({ client, config, capture, log, onSessionStateChange } = {}) {
  let running = true;
  let currentIntervalMinutes = null;
  let currentLiveSeconds = null;
  let scheduledTimer = null;
  let liveTimer = null;
  let sessionActive = false;

  async function tickScheduled() {
    if (!running || !sessionActive) return;
    try {
      const filePath = await capture.captureFull();
      const uploaded = await client.uploadFile(config.deviceToken, filePath);
      await client.postScheduledScreenshot(config.deviceToken, uploaded.url, uploaded.filename);
      capture.cleanup(filePath);
      log(`Scheduled screenshot captured and uploaded (${uploaded.url}).`);
    } catch (e) {
      log(`Scheduled capture failed: ${e.message}`);
    }
  }

  async function tickLive() {
    if (!running || !sessionActive) return;
    try {
      const filePath = await capture.captureLive();
      const uploaded = await client.uploadFile(config.deviceToken, filePath);
      await client.postLiveFrame(config.deviceToken, uploaded.url);
      capture.cleanup(filePath);
    } catch (e) {
      log(`Live frame failed: ${e.message}`);
    }
  }

  function applyConfig(cfg) {
    if (cfg.screenshotIntervalMinutes !== currentIntervalMinutes) {
      currentIntervalMinutes = cfg.screenshotIntervalMinutes;
      if (scheduledTimer) clearInterval(scheduledTimer);
      scheduledTimer = setInterval(tickScheduled, currentIntervalMinutes * 60 * 1000);
      log(`Scheduled screenshot interval set to ${currentIntervalMinutes} minute(s).`);
    }
    if (cfg.liveViewFrameIntervalSeconds !== currentLiveSeconds) {
      currentLiveSeconds = cfg.liveViewFrameIntervalSeconds;
      if (liveTimer) clearInterval(liveTimer);
      liveTimer = setInterval(tickLive, currentLiveSeconds * 1000);
      log(`Live frame interval set to ${currentLiveSeconds} second(s).`);
    }
  }

  async function pollConfigAndStatus() {
    if (!running) return;
    try {
      const [cfg, session] = await Promise.all([
        client.getConfig(config.deviceToken),
        client.getSessionStatus(config.deviceToken),
      ]);
      applyConfig(cfg);
      const wasActive = sessionActive;
      sessionActive = session.status === 'active';

      if (sessionActive !== wasActive) {
        onSessionStateChange?.(sessionActive);
      }

      if (sessionActive && !wasActive) log('Session is now Active — monitoring started.');
      if (!sessionActive && wasActive) log('Session is no longer Active — monitoring paused.');
    } catch (e) {
      log(`Config/status poll failed: ${e.message}`);
    }
  }

  // Poll config + session status every 30s (cheap request; catches interval changes
  // and Start/Stop Session clicks without needing the agent to restart).
  const pollTimer = setInterval(pollConfigAndStatus, 30 * 1000);
  pollConfigAndStatus();

  return {
    stop() {
      running = false;
      clearInterval(pollTimer);
      if (scheduledTimer) clearInterval(scheduledTimer);
      if (liveTimer) clearInterval(liveTimer);
    },
    // exposed for testing
    _internal: { tickScheduled, tickLive, applyConfig, pollConfigAndStatus, getSessionActive: () => sessionActive },
  };
}

module.exports = { startScheduler };
