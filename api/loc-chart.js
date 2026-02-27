// @ts-check

import { renderLocChart } from "../src/cards/loc-chart.js";
import {
  CACHE_TTL,
  resolveCacheSeconds,
  setCacheHeaders,
  setErrorCacheHeaders,
} from "../src/common/cache.js";
import {
  MissingParamError,
  retrieveSecondaryMessage,
} from "../src/common/error.js";
import { parseBoolean } from "../src/common/ops.js";
import { renderError } from "../src/common/render.js";
import { fetchLoc } from "../src/fetchers/loc.js";

// @ts-ignore
export default async (req, res) => {
  const {
    username,
    include_orgs,
    bg_color,
    line_color,
    area_color,
    point_color,
    title_color,
    text_color,
    hide_border,
    custom_title,
    cache_seconds,
  } = req.query;

  res.setHeader("Content-Type", "image/svg+xml");

  if (!username) {
    return res.send(
      renderError({
        message: "Missing required parameter: username",
        renderOptions: { title_color, text_color, bg_color, border_color: undefined, theme: undefined },
      }),
    );
  }

  try {
    const locData = await fetchLoc(username, include_orgs);
    const cacheSeconds = resolveCacheSeconds({
      requested: parseInt(cache_seconds, 10),
      def: CACHE_TTL.TOP_LANGS_CARD?.DEFAULT || 14400,
      min: CACHE_TTL.TOP_LANGS_CARD?.MIN || 7200,
      max: CACHE_TTL.TOP_LANGS_CARD?.MAX || 86400,
    });

    setCacheHeaders(res, cacheSeconds);

    return res.send(
      renderLocChart(locData, {
        bg_color,
        line_color,
        area_color,
        point_color,
        title_color,
        text_color,
        hide_border: hide_border === undefined ? true : parseBoolean(hide_border),
        custom_title,
      }),
    );
  } catch (err) {
    setErrorCacheHeaders(res);
    if (err instanceof Error) {
      return res.send(
        renderError({
          message: err.message,
          secondaryMessage: retrieveSecondaryMessage(err),
          renderOptions: { title_color, text_color, bg_color, border_color: undefined, theme: undefined },
        }),
      );
    }
    return res.send(
      renderError({
        message: "An unknown error occurred",
        renderOptions: { title_color, text_color, bg_color, border_color: undefined, theme: undefined },
      }),
    );
  }
};
