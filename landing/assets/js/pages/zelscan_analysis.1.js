document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', function(e) {
    if (this.getAttribute('href') === '#') e.preventDefault();
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
  });
});
