/* Sadarshop — storefront behaviour. No dependencies. */
(function () {
  'use strict';

  /* auto-dismiss toasts */
  document.querySelectorAll('.toast').forEach(function (t, i) {
    setTimeout(function () {
      t.style.transition = 'opacity .35s, transform .35s';
      t.style.opacity = '0'; t.style.transform = 'translateX(24px)';
      setTimeout(function () { t.remove(); }, 400);
    }, 4200 + i * 350);
  });

  /* quantity steppers */
  window.stepQty = function (btn, delta) {
    var input = btn.parentNode.querySelector('input[type=number]');
    if (!input) return;
    var min = parseInt(input.min || '1', 10) || 1;
    input.value = Math.max(min, (parseInt(input.value, 10) || min) + delta);
    input.dispatchEvent(new Event('change'));
  };

  /* pcard carousel navigation */
  window.navPcard = function (id, dir) {
    var car = document.getElementById('pcard-car-' + id);
    if (!car) return;
    var maxScroll = car.scrollWidth - car.clientWidth;
    if (dir === 1) {
      if (car.scrollLeft >= maxScroll - 10) {
        car.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        car.scrollBy({ left: car.clientWidth, behavior: 'smooth' });
      }
    } else {
      if (car.scrollLeft <= 10) {
        car.scrollTo({ left: maxScroll, behavior: 'smooth' });
      } else {
        car.scrollBy({ left: -car.clientWidth, behavior: 'smooth' });
      }
    }
  };

  /* product tabs */
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('on'); });
      document.querySelectorAll('.tabpane').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var pane = document.getElementById('tab-' + b.dataset.tab);
      if (pane) pane.classList.add('on');
    });
  });

  /* wishlist toggle */
  document.querySelectorAll('[data-wish]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('/wishlist/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: btn.dataset.wish })
      }).then(function (r) { return r.json(); }).then(function (d) {
        btn.classList.toggle('on', d.saved);
        document.querySelectorAll('a[href="/wishlist"] .count').forEach(function (c) { c.textContent = d.count; });
        toast(d.saved ? 'Saved to your wishlist' : 'Removed from wishlist');
      }).catch(function () { toast('Could not update the wishlist', 'err'); });
    });
  });

  /* ---- AJAX add-to-enquiry (no page redirect) ---- */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.getAttribute('action') !== '/enquiry/add') return;
    e.preventDefault();

    var btn = form.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; }

    var body = new URLSearchParams(new FormData(form)).toString();
    fetch('/enquiry/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        /* update every enquiry badge on the page */
        document.querySelectorAll('a[href="/enquiry"] .count').forEach(function (c) {
          c.textContent = d.count;
        });
        toast('Added to enquiry list ✓');
      } else {
        toast('Could not add item', 'err');
      }
    })
    .catch(function () { toast('Could not add item', 'err'); })
    .finally(function () {
      if (btn) { btn.disabled = false; }
    });
  });

  function toast(msg, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .35s'; el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 400);
    }, 3000);
  }
  window.stToast = toast;

  /* keep query params when changing sort / page size */
  window.updateQuery = function (key, value) {
    var u = new URL(location.href);
    u.searchParams.set(key, value);
    u.searchParams.delete('page');
    return u.pathname + '?' + u.searchParams.toString();
  };

  /* mobile filter toggle */
  var ft = document.getElementById('filterToggle');
  if (ft && window.matchMedia('(max-width:900px)').matches) ft.style.display = 'inline-flex';

  /* close mega menu on outside click */
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.megawrap.open').forEach(function (m) {
      if (!m.contains(e.target)) m.classList.remove('open');
    });
  });
})();
