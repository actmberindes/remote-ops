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
        isRdp: telemetry.isRdp,
        sessionName: telemetry.sessionName,
        agentVersion: config.agentVersion,
        ipAddress: telemetry.ipAddress,
        operatingSystem: telemetry.operatingSystem,
      });
      onDeviceStateChange?.(telemetry.state, telemetry);
      if (telemetry.state === 'active') log(`Heartbeat: Active — ${telemetry.domainUser || 'No user'}${telemetry.isRdp ? ' (RDP)' : ''}.`);
      else if (telemetry.state === 'idle') log(`Heartbeat: Idle — ${telemetry.domainUser || 'No user'} (5+ minutes)${telemetry.isRdp ? ' (RDP)' : ''}.`);
      else if (telemetry.sessionLocked) log('Heartbeat: Workstation locked — monitoring paused until an interactive user unlocks the workstation.');
      else log('Heartbeat: No logged-in Windows user.');
    } catch (e) {
      onDeviceStateChange?.('offline');
      log(`Heartbeat failed: ${e.message}`);
    }
  }

  async function uploadCaptures(captures, postCapture, type = 'screenshot') {
    const uploaded = [];
    for (const item of captures) {
      try {
        const result = await client.uploadFile(config.deviceToken, item.filePath, type);
        await postCapture(result, item);
        uploaded.push({ ...item, url: result.url, filename: result.filename });
      } finally {
        capture.cleanup(item.filePath);
      }
    }
    return uploaded;
  }

  function capturesForSession(captures, telemetry) {
    if (!telemetry.isRdp) return captures;
    return captures.filter(item => Number(item.displayIndex) === 1).slice(0, 1);
  }

  function sameInteractiveUser(a, b) {
    return Boolean(
      a?.domainUser &&
      b?.domainUser &&
      String(a.domainUser).toLowerCase() === String(b.domainUser).toLowerCase()
    );
  }

  async function tickScheduled() {
    if (!running) return;
    const telemetry = getDeviceState();
    if (telemetry.state === 'logged-out') {
      log(telemetry.sessionLocked
        ? 'Scheduled screenshot skipped: workstation is locked.'
        : 'Scheduled screenshot skipped: no logged-in Windows user.');
      return;
    }
    try {
      log(`Scheduled screenshot identity: ${telemetry.domainUser || 'No user'}${telemetry.isRdp ? ` (RDP ${telemetry.sessionName || ''})` : ''}.`);
      const allCaptures = await capture.captureFullAll();
      const latestTelemetry = getDeviceState();

      // A user can switch sessions or lock the workstation while the screenshot
      // is being captured. Do not upload a frame taken across that transition.
      if (
        latestTelemetry.state === 'logged-out' ||
        !sameInteractiveUser(telemetry, latestTelemetry)
      ) {
        log(`Scheduled screenshot discarded: interactive user changed from ${telemetry.domainUser || 'none'} to ${latestTelemetry.domainUser || 'none'}.`);
        allCaptures.forEach(item => capture.cleanup(item.filePath));
        return;
      }

      const captures = capturesForSession(allCaptures, latestTelemetry);
      await uploadCaptures(captures, async (result, item) => {
        await client.postScheduledScreenshot(
          config.deviceToken,
          result.url,
          result.filename,
          item,
          latestTelemetry
        );
      }, 'screenshot');
      log(`Scheduled screenshot captured for ${captures.length} display(s)${latestTelemetry.isRdp ? ' (RDP primary display only).' : '.'}`);
    } catch (e) {
      log(`Scheduled capture failed: ${e.message}`);
    }
  }

  async function tickLive() {
    if (!running) return;
    const telemetry = getDeviceState();
    if (telemetry.state === 'logged-out') {
      log(telemetry.sessionLocked
        ? 'Live frame skipped: workstation is locked.'
        : 'Live frame skipped: no logged-in Windows user.');
      return;
    }
    try {
      const allCaptures = await capture.captureLiveAll();
      const latestTelemetry = getDeviceState();

      if (
        latestTelemetry.state === 'logged-out' ||
        !sameInteractiveUser(telemetry, latestTelemetry)
      ) {
        log(`Live frame discarded: interactive user changed from ${telemetry.domainUser || 'none'} to ${latestTelemetry.domainUser || 'none'}.`);
        allCaptures.forEach(item => capture.cleanup(item.filePath));
        return;
      }

      const captures = capturesForSession(allCaptures, latestTelemetry);
      await uploadCaptures(captures, async (result, item) => {
        await client.postLiveFrame(config.deviceToken, result.url, item);
      }, 'live');
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