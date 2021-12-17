import queryString from 'qs';

// imageishThing can be:
// * upload JSON API
// * video JSON API

function getUrl({ imageishThing, plugin }) {
  if (!imageishThing) {
    return null;
  }

  if (imageishThing.thumbnail_url) {
    return { url: imageishThing.thumbnail_url };
  }

  const payload = imageishThing.attributes || imageishThing;

  if (payload.mux_playback_id) {
    return {
      isMux: true,
      url: `https://image.mux.com/${payload.mux_playback_id}/thumbnail.jpg`,
    };
  }

  const path = payload.path.startsWith('/') ? payload.path.slice(1) : payload.path;

  return {
    url: `https://${plugin.site.attributes.imgix_host}/${path}`,
    isImgix: true,
  };
}

export default function imgixThumbUrl({ plugin, imageishThing, params }) {
  const result = getUrl({ imageishThing, plugin });

  if (!result) {
    return null;
  }

  const { isImgix, isMux, url } = result;

  if (params && isMux) {
    const muxParams = {};
    if (params.w) {
      muxParams.width = params.w;
    }
    if (params.h) {
      muxParams.height = params.h;
    }
    return `${url}?${queryString.stringify(params)}`;
  }

  if (params && isImgix) {
    return `${url}?${queryString.stringify(params)}`;
  }

  return url;
}
