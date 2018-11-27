import './style.sass';
import request from 'superagent';
import template from './template.ejs';
import empty from './empty.ejs';
import colorFor from './colorFor';
import titleize from './titleize';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  const userId = plugin.getFieldValue(plugin.fieldPath);

  const container = document.createElement('div');
  container.classList.add('container');
  document.body.appendChild(container);

  if (userId) {
    request
      .get(plugin.parameters.global.endpointUrl)
      .set('Authorization', `Bearer ${plugin.parameters.global.accessToken}`)
      .query({ id: userId })
      .then(({ body: user }) => {
        const fullName = user.user_metadata && user.user_metadata.full_name;
        const initial = (fullName || user.email)[0];

        container.innerHTML = template({
          fullName,
          email: user.email,
          createdAt: user.created_at,
          color: colorFor(fullName || user.email),
          initial,
          metadata: Object.entries(user.user_metadata || {})
            .map(([key, value]) => ({ key: titleize(key), value })),
        });
      })
      .catch((e) => {
        if (e.status === 404) {
          container.innerHTML = empty({
            message: 'User no longer existent!',
            submessage: userId,
          });
        } else {
          container.innerHTML = empty({
            message: e.message,
            submessage: false,
          });
        }
      });
  } else {
    container.innerHTML = empty({ message: 'No user present', submessage: false });
  }
});
