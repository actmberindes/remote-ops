/* Small presentation polish for the per-device details page. */

function renameHourlyActivity() {
  document.querySelectorAll('*').forEach(element => {
    if (element.children.length > 0) return;
    const text = (element.textContent || '').trim();
    if (text === 'Keyboard / Mouse Hourly Activity') {
      element.textContent = 'Hourly Workstation Activity';
    }
    if (text === 'Dark green = 100% active · light green = 0% active / idle') {
      element.textContent = '100% = Active · 0% = Idle (based on workstation idle state)';
    }
  });
}

function start() {
  renameHourlyActivity();
  const observer = new MutationObserver(renameHourlyActivity);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

export {};
