const fetch = require('./utils/fetchJson');
const responders = require('./utils/responders');

function generateHandler(accessToken) {
  return function handler(event, context) {
    const { id: userId } = event.queryStringParameters;

    if (event.httpMethod === 'OPTIONS') {
      return responders.succeed({});
    }

    if (!userId) {
      return responders.fail('ID_PARAMETER_NEEDED', 'You need to pass an ID query string');
    }

    if (event.httpMethod !== 'GET') {
      return responders.fail('INVALID_REQUEST', 'Invalid request!');
    }

    const { authorization } = event.headers;
    const expectedAuthorization = `Bearer ${accessToken}`;

    if (authorization !== expectedAuthorization) {
      return responders.fail(
        'ACCESS_TOKEN_REQUIRED',
        'You need to pass an Authorization header with the correct access token',
        401
      );
    }

    const { identity } = context.clientContext;

    const userUrl = `${identity.url}/admin/users/${userId}`;

    return fetch(userUrl, identity.token)
      .then(user => responders.succeed(user))
      .catch((e) => {
        console.log(e);
        return responders.fail('EXCEPTION', e.message, e.code || 500)
      });
  }
}

module.exports = generateHandler;
