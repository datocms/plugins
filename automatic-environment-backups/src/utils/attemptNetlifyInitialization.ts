const attemptNetlifyInitialization = async (netlifyURL: string) => {
  const fomratedURL = netlifyURL + '/.netlify/functions/initialization';

  try {
    const response = await fetch(fomratedURL, {
      method: 'GET',
      headers: { Accept: '*/*' },
    });
  } catch {
    throw new Error("Couldn't initialize!");
  }
};

export default attemptNetlifyInitialization;
