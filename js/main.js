(function () {
  'use strict';

  /* ================================================================
     UI: header, reveal, rail, scroll progress
     ================================================================ */
  var header = document.getElementById('header');
  var loader = document.getElementById('loader');
  var rail = document.getElementById('rail');
  var stages = Array.prototype.slice.call(document.querySelectorAll('.stage'));
  var journey = document.getElementById('services');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.getElementById('year').textContent = new Date().getFullYear();

  function hideLoader() { loader.classList.add('is-done'); }

  // rail dots
  var railLinks = stages.map(function (el, i) {
    if (!el.id) el.id = 'stage-' + i;
    var a = document.createElement('a');
    a.href = '#' + el.id;
    a.textContent = el.dataset.label || '';
    rail.appendChild(a);
    return a;
  });

  // reveal on scroll
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach(function (el, i) {
      el.style.transitionDelay = (i % 5) * 70 + 'ms';
      io.observe(el);
    });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-in'); });
  }

  // scroll position -> continuous stage index (0 = hero, 1..6 = services)
  var centers = [], journeyEnd = 0, stageT = 0, activeStage = -1;

  function measure() {
    var sy = window.scrollY;
    centers = stages.map(function (el) {
      var r = el.getBoundingClientRect();
      return r.top + sy + r.height / 2;
    });
    journeyEnd = journey.getBoundingClientRect().bottom + sy;
  }

  function smooth(a, b, x) {
    x = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }

  function onScroll() {
    var sy = window.scrollY, y = sy + window.innerHeight / 2, n = centers.length;
    header.classList.toggle('is-scrolled', sy > 20);

    var raw = n - 1;
    if (y <= centers[0]) raw = 0;
    else {
      for (var i = 0; i < n - 1; i++) {
        if (y < centers[i + 1]) { raw = i + (y - centers[i]) / (centers[i + 1] - centers[i]); break; }
      }
    }
    var base = Math.floor(raw);
    stageT = base + smooth(0.18, 0.82, raw - base);

    var active = y > journeyEnd ? -1 : Math.round(raw);        // no card once the services are scrolled past
    if (active !== activeStage) {
      activeStage = active;
      stages.forEach(function (el, i) { el.classList.toggle('is-active', i === active); });
      railLinks.forEach(function (a, i) { a.classList.toggle('is-active', i === active); });
    }
    rail.classList.toggle('is-hidden', sy + window.innerHeight * 0.6 > journeyEnd);
  }

  measure(); onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { measure(); onScroll(); });
  window.addEventListener('load', function () { measure(); onScroll(); });

  // shared with the 3D showcase (js/showcase.js)
  window.SITE = {
    stageT: function () { return stageT; },
    journeyEnd: function () { return journeyEnd; },
    hideLoader: hideLoader,
    reduceMotion: reduceMotion
  };
  setTimeout(hideLoader, 4000);
})();
