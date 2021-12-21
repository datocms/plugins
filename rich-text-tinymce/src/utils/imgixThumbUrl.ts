import { RenderFieldExtensionCtx, Upload } from "datocms-plugin-sdk";
import queryString from "qs";

// imageishThing can be:
// * upload JSON API
// * video JSON API

type GetUrlParams = {
  imageishThing: Upload;
  ctx: RenderFieldExtensionCtx;
};

type ImgixThumbUrlParams = {
  imageishThing: Upload;
  ctx: RenderFieldExtensionCtx;
  params?: {
    h: string;
    w: string;
  };
};

type MuxParams = {
  height: string;
  width: string;
};

function getUrl({ imageishThing, ctx }: GetUrlParams) {
  if (!imageishThing) {
    return null;
  }

  // if (imageishThing.thumbnail_url) {
  //   return { url: imageishThing.thumbnail_url };
  // }

  const payload = imageishThing.attributes || imageishThing;

  if (payload.mux_playback_id) {
    return {
      isMux: true,
      url: `https://image.mux.com/${payload.mux_playback_id}/thumbnail.jpg`,
    };
  }

  const path = payload.path.startsWith("/")
    ? payload.path.slice(1)
    : payload.path;

  return {
    url: `https://${ctx.site.attributes.imgix_host}/${path}`,
    isImgix: true,
  };
}

export default function imgixThumbUrl({
  ctx,
  imageishThing,
  params,
}: ImgixThumbUrlParams) {
  const result = getUrl({ imageishThing, ctx });

  if (!result) {
    return null;
  }

  const { isImgix, isMux, url } = result;

  if (params && isMux) {
    const muxParams = {} as MuxParams;

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
