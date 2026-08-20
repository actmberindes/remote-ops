const { getDeviceState } = require('./telemetry.js');

const HEARTBEAT_PERIOD_MS = 30 * 1000;

function startScheduler({ client, config, capture, log, onSessionStateChange, onDeviceStateChange } = {}) {
  let running = true;
  let currentIntervalMinutes = null;
  let currentLiveSeconds = null;
  let scheduledTimer = null;
  let liveTimer = null;

  async function sendHeartbeat() {
    if (!running || !config.deviceToken) return;

    try {
      const telemetry = getDeviceState();
      await client.heartbeat(config.deviceToken, {
        state: telemetry.state,
        machineId: telemetry.machineId,
        hostname: telemetry.hostname,
        domain: telemetry.domain,
        domainUser: telemetry.domainUser,
        agentVersion: config.agentVersion,
      });

      onDeviceStateChange?.(telemetry.state, telemetry);
      if (telemetry.state === 'active') {
        log(`Heartbeat: Active — ${telemetry.domainUser || 'No user'}.`);
      } else if (telemetry.state === 'idle') {
        log(`Heartbeat: Idle — ${telemetry.domainUser || 'No user'} (5+ minutes).`);
      } else {
        log('Heartbeat: No logged-in Windows user.');
      }
    } catch (e) {
      onDeviceStateChange?.('offline');
      log(`Heartbeat failed: ${e.message}`);
    }
  }

  async function tickScheduled() {
    if (!running) return;
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
    if (!running) return;
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

  async function pollConfig() {
    if (!running) return;
    try {
      const cfg = await client.getConfig(config.deviceToken);
      applyConfig(cfg);
    } catch (e) {
      log(`Config poll failed: ${e.message}`);
    }
  }

  async function initialSync() {
    await pollConfig();
    await sendHeartbeat();
  }

  // Monitoring is now automatic for an enrolled device. There is no employee
  // Start/Stop session check in the scheduler.
  const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_PERIOD_MS);
  const configTimer = setInterval(pollConfig, HEARTBEAT_PERIOD_MS);

  initialSync();

  return {
    stop() {
      running = false;
      clearInterval(heartbeatTimer);
      clearInterval(configTimer);
      if (scheduledTimer) clearInterval(scheduledTimer);
      if (liveTimer) clearInterval(liveTimer);
    },
    _internal: { tickScheduled, tickLive, applyConfig, sendHeartbeat },
  };
}

module.exports = { startScheduler };
