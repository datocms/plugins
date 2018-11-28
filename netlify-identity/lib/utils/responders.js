const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization'
};

const responders = {
  succeed(response, statusCode = 200, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
    };

    Object.assign(headers, corsHeaders);

    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    const httpResponse = {
      statusCode,
      headers,
      body: JSON.stringify(response),
    };

    return httpResponse;
  },
  fail(code, message, status = 422, options = {}) {
    return responders.succeed({ code, message }, status, options);
  }
};

module.exports = responders;
