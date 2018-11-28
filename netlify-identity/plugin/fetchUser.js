import request from 'superagent';

export default (userId, config) => (
  request
    .get(config.endpointUrl)
    .set('Authorization', `Bearer ${config.accessToken}`)
    .query({ id: userId })
    .then(({ body: user }) => ({ user, status: 'success' }))
    .catch((e) => {
      if (e.status === 404) {
        return { user: null, status: 'notFound' };
      }

      return {
        user: null,
        status: 'error',
        error: e.message,
        details: (e.response && e.response.body && e.response.body.message),
      };
    })
);
