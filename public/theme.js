// Runs before the page paints, so a theme picked in Settings shows from the first frame.
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* no storage: follow the system */ }
})();
