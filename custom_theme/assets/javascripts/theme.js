(function () {
  // Initialize theme on page load
  const stored = localStorage.getItem('theme');
  if (stored) {
    document.documentElement.setAttribute('data-theme', stored);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
})();

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

function toggleMobileMenu() {
  const nav = document.getElementById('mainNav');
  if (nav) {
    nav.classList.toggle('active');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('docsSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar && backdrop) {
    sidebar.classList.toggle('active');
    backdrop.classList.toggle('active');
  }
}

// Close mobile menu when clicking on a link
document.addEventListener('DOMContentLoaded', function() {
  const navLinks = document.querySelectorAll('#mainNav a');
  navLinks.forEach(link => {
    link.addEventListener('click', function() {
      const nav = document.getElementById('mainNav');
      if (nav && nav.classList.contains('active')) {
        nav.classList.remove('active');
      }
    });
  });

  // Close sidebar when clicking on a link (mobile only)
  const sidebarLinks = document.querySelectorAll('#docsSidebar a');
  const mobileBreakpoint = 768;
  
  sidebarLinks.forEach(link => {
    link.addEventListener('click', function() {
      if (window.innerWidth <= mobileBreakpoint) {
        const sidebar = document.getElementById('docsSidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (sidebar && backdrop) {
          sidebar.classList.remove('active');
          backdrop.classList.remove('active');
        }
      }
    });
  });

  // Close menus when clicking outside
  document.addEventListener('click', function(event) {
    const nav = document.getElementById('mainNav');
    const menuToggle = document.querySelector('.mobile-menu-toggle');
    
    if (nav && menuToggle && 
        !nav.contains(event.target) && 
        !menuToggle.contains(event.target) &&
        nav.classList.contains('active')) {
      nav.classList.remove('active');
    }
  });
});
