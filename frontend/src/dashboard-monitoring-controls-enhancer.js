/* Keep the Dashboard's Recent Screenshots size slider local to the card.
   The legacy dashboard card can be navigable; the range input itself must never
   bubble its pointer/click events into that navigation handler. */

function isRecentScreenshotsRange(target) {
  if (!(target instanceof HTMLInputElement) || target.type !== 'range') return false;
  const card = target.closest('.card');
  if (!card) return false;
  return /Recent Screenshots/i.test(card.textContent || '');
}

function stopDashboardSliderNavigation(event) {
  if (!isRecentScreenshotsRange(event.target)) return;
  event.stopPropagation();
}

document.addEventListener('pointerdown', stopDashboardSliderNavigation, true);
document.addEventListener('mousedown', stopDashboardSliderNavigation, true);
document.addEventListener('touchstart', stopDashboardSliderNavigation, true);
document.addEventListener('click', stopDashboardSliderNavigation, true);
document.addEventListener('input', stopDashboardSliderNavigation, true);
document.addEventListener('change', stopDashboardSliderNavigation, true);

document.addEventListener('keydown', (event) => {
  if (!isRecentScreenshotsRange(event.target)) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(event.key)) {
    event.stopPropagation();
  }
}, true);
