import './style.sass';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  const container = document.createElement('div');
  container.classList.add('container');
  container.textContent = 'Hello, world!';

  document.body.appendChild(container);
});
