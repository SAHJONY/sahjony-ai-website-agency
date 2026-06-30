/* Shared UI/UX behavior — scroll-aware header + reveal-on-scroll.
   Defensive: only elements below the fold are hidden then revealed, so there's
   no flash and no-JS leaves everything visible. */
(function () {
  // Sticky header shadow on scroll.
  var h = document.querySelector("header");
  if (h) {
    var onScroll = function () {
      h.classList.toggle("ui-scrolled", (window.scrollY || document.documentElement.scrollTop) > 16);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Reveal cards / sections as they enter the viewport.
  if (!("IntersectionObserver" in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.remove("reveal-init"); e.target.classList.add("reveal-in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });

  var vh = window.innerHeight || document.documentElement.clientHeight;
  document.querySelectorAll(".card, .sec").forEach(function (el) {
    if (el.getBoundingClientRect().top > vh * 0.9) { el.classList.add("reveal-init"); io.observe(el); }
  });
})();
